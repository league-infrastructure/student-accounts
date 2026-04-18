/**
 * CohortService — domain logic for the Cohort entity.
 *
 * Responsibilities:
 *  - Cohort CRUD
 *  - Audit event recording for state-changing operations
 *
 * Note: Google Workspace OU provisioning is deferred to a later sprint.
 * This service covers only in-database operations.
 */

import { NotFoundError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import { CohortRepository } from './repositories/cohort.repository.js';
import type { Cohort } from '../generated/prisma/client.js';

export class CohortService {
  constructor(
    private prisma: any,
    private audit: AuditService,
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
}
