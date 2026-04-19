/**
 * CohortService — domain logic for the Cohort entity.
 *
 * Responsibilities:
 *  - Cohort CRUD
 *  - Audit event recording for state-changing operations
 *  - Google Workspace OU provisioning via createWithOU (Sprint 004)
 */

import pino from 'pino';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import type { GoogleWorkspaceAdminClient } from './google-workspace/google-workspace-admin.client.js';
import { CohortRepository } from './repositories/cohort.repository.js';
import type { Cohort } from '../generated/prisma/client.js';

const logger = pino({ name: 'cohort-service' });

export class CohortService {
  constructor(
    private prisma: any,
    private audit: AuditService,
    private googleClient?: GoogleWorkspaceAdminClient,
  ) {}

  /**
   * Create a new Cohort and record a `create_cohort` audit event
   * atomically in a single transaction.
   */
  async create(
    data: { name: string; google_ou_path?: string | null },
    actorId: number | null = null,
  ): Promise<Cohort> {
    return this.prisma.$transaction(async (tx: any) => {
      const cohort = await CohortRepository.create(tx, data);
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'create_cohort',
        target_entity_type: 'Cohort',
        target_entity_id: String(cohort.id),
      });
      return cohort;
    });
  }

  /**
   * Create a new Cohort with a corresponding Google Workspace OU.
   *
   * Sequence (per Architecture Decision 3):
   *  1. Validate name is non-blank and not already used.
   *  2. Call googleClient.createOU(name) — creates the OU under GOOGLE_STUDENT_OU_ROOT.
   *  3. Open a prisma.$transaction: CohortRepository.create + AuditService.record.
   *
   * If createOU succeeds but the Prisma write fails, the OU may be orphaned.
   * That is the documented edge case; a retry should handle "OU already exists"
   * gracefully. A warning is logged whenever this situation is detected.
   *
   * @param name    - The cohort name (must be non-blank and unique).
   * @param actorId - The admin performing the action (used in audit event).
   * @returns The newly created Cohort row.
   *
   * @throws ValidationError  if name is blank.
   * @throws ConflictError    if a cohort with this name already exists.
   * @throws Error            if googleClient is not configured.
   * @throws WorkspaceWriteDisabledError / WorkspaceApiError propagated from the client.
   */
  async createWithOU(name: string, actorId: number): Promise<Cohort> {
    if (!this.googleClient) {
      throw new Error(
        'CohortService.createWithOU requires a GoogleWorkspaceAdminClient. ' +
          'Pass the client as the third constructor argument.',
      );
    }

    // --- 1. Validate name ---
    const trimmedName = name.trim();
    if (!trimmedName) {
      throw new ValidationError('Cohort name must not be blank.');
    }

    const existing = await CohortRepository.findByName(this.prisma, trimmedName);
    if (existing) {
      throw new ConflictError(`A cohort named "${trimmedName}" already exists.`);
    }

    // --- 2. Create the Google Workspace OU (side-effectful; not reversible) ---
    logger.info({ name: trimmedName, actorId }, '[cohort-service] Calling createOU');
    const createdOU = await this.googleClient.createOU(trimmedName);
    logger.info(
      { name: trimmedName, ouPath: createdOU.ouPath },
      '[cohort-service] OU created successfully',
    );

    // --- 3. Persist the Cohort row and audit event in a single transaction ---
    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const cohort = await CohortRepository.create(tx, {
          name: trimmedName,
          google_ou_path: createdOU.ouPath,
        });
        await this.audit.record(tx, {
          actor_user_id: actorId,
          action: 'create_cohort',
          target_entity_type: 'Cohort',
          target_entity_id: String(cohort.id),
          details: { name: trimmedName, google_ou_path: createdOU.ouPath },
        });
        return cohort;
      });
    } catch (prismaErr) {
      // The OU already exists in Google Workspace — document and warn.
      logger.warn(
        { name: trimmedName, ouPath: createdOU.ouPath, err: prismaErr },
        '[cohort-service] Prisma write failed after successful OU creation. ' +
          'OU is orphaned in Google Workspace. Retry should handle "OU already exists" gracefully.',
      );
      throw prismaErr;
    }
  }

  /**
   * Find a Cohort by its primary key.
   * Throws NotFoundError if the cohort does not exist.
   */
  async findById(id: number): Promise<Cohort> {
    const cohort = await CohortRepository.findById(this.prisma, id);
    if (!cohort) throw new NotFoundError(`Cohort ${id} not found`);
    return cohort;
  }

  /** Return all cohorts ordered by name. */
  async findAll(): Promise<Cohort[]> {
    return CohortRepository.findAll(this.prisma);
  }

  /** Return the cohort with the given name, or null if none exists. */
  async findByName(name: string): Promise<Cohort | null> {
    return CohortRepository.findByName(this.prisma, name);
  }

  /**
   * Upsert a Cohort keyed on google_ou_path.
   *
   * - If no cohort with this google_ou_path exists, creates a new row with the
   *   given name and ouPath.
   * - If a cohort exists and the name matches, returns it unchanged.
   * - If a cohort exists but has a different name, updates the name field.
   *
   * Does NOT call createOU or any Google Admin SDK method — the OU already
   * exists and we are importing, not creating.
   *
   * @param ouPath  - The Google Workspace OU path (e.g. "/Students/Spring2025").
   * @param name    - The display name for the cohort (e.g. "Spring2025").
   * @param actorId - The user performing this action; null for system.
   * @returns The upserted Cohort row.
   */
  async upsertByOUPath(
    ouPath: string,
    name: string,
    actorId: number | null = null,
  ): Promise<Cohort> {
    const existing = await CohortRepository.findByOUPath(this.prisma, ouPath);

    if (existing) {
      if (existing.name === name) {
        return existing;
      }
      // Name changed — update it
      logger.info(
        { ouPath, oldName: existing.name, newName: name, actorId },
        '[cohort-service] upsertByOUPath: updating cohort name',
      );
      return this.prisma.$transaction(async (tx: any) => {
        const updated = await CohortRepository.update(tx, existing.id, { name });
        await this.audit.record(tx, {
          actor_user_id: actorId,
          action: 'update_cohort',
          target_entity_type: 'Cohort',
          target_entity_id: String(existing.id),
          details: { google_ou_path: ouPath, old_name: existing.name, new_name: name },
        });
        return updated;
      });
    }

    // Not found — create
    logger.info(
      { ouPath, name, actorId },
      '[cohort-service] upsertByOUPath: creating new cohort',
    );
    return this.prisma.$transaction(async (tx: any) => {
      const cohort = await CohortRepository.create(tx, { name, google_ou_path: ouPath });
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'create_cohort',
        target_entity_type: 'Cohort',
        target_entity_id: String(cohort.id),
        details: { google_ou_path: ouPath },
      });
      return cohort;
    });
  }
}
