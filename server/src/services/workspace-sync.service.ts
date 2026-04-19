/**
 * WorkspaceSyncService — imports Google Workspace directory state into the
 * local database.
 *
 * This service is the core of the Google Workspace sync epic (SUC-001 through
 * SUC-004). It reads the directory via GoogleWorkspaceAdminClient and upserts
 * local Cohort, User, and ExternalAccount rows to match.
 *
 * Methods:
 *  - syncCohorts  — import child OUs under GOOGLE_STUDENT_OU_ROOT as Cohorts.
 *  - syncStaff    — import users in GOOGLE_STAFF_OU_PATH as staff Users.
 *  - syncStudents — import users in student OUs as student Users, flag removed
 *                   workspace ExternalAccounts.
 *  - syncAll      — run syncCohorts → syncStaff → syncStudents in sequence,
 *                   continuing past individual sub-operation failures.
 *
 * Design notes:
 *  - Each method is designed to accept an optional Prisma transaction client
 *    (`tx`). When provided, all DB writes happen inside that transaction.
 *    When omitted, the service uses `this.prisma` directly (auto-commit).
 *  - Audit events are emitted at the end of each sync method.
 *  - Admin role is never downgraded (preserve admin).
 *  - syncStudents includes flag-only removal: workspace ExternalAccount rows
 *    whose user email was not seen in any OU listing are set to status=removed.
 */

import pino from 'pino';
import type { AuditService } from './audit.service.js';
import type { GoogleWorkspaceAdminClient } from './google-workspace/google-workspace-admin.client.js';
import type { CohortService } from './cohort.service.js';
import { UserRepository } from './repositories/user.repository.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import { CohortRepository } from './repositories/cohort.repository.js';
import type { Cohort } from '../generated/prisma/client.js';

const logger = pino({ name: 'workspace-sync' });

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface WorkspaceSyncReport {
  /** Count of Cohort rows created or updated by syncCohorts. */
  cohortsUpserted?: number;
  /** Count of staff User rows created or updated by syncStaff. */
  staffUpserted?: number;
  /** Count of student User rows created or updated by syncStudents. */
  studentsUpserted?: number;
  /**
   * Emails of workspace ExternalAccount rows flagged as removed because their
   * email was not seen in any OU listing during syncStudents.
   */
  flaggedAccounts?: string[];
  /** Non-fatal errors from sub-operations in syncAll. */
  errors?: Array<{ operation: string; error: string }>;
}

// ---------------------------------------------------------------------------
// WorkspaceSyncService
// ---------------------------------------------------------------------------

export class WorkspaceSyncService {
  constructor(
    private readonly prisma: any,
    private readonly googleClient: GoogleWorkspaceAdminClient,
    private readonly cohortService: CohortService,
    private readonly userRepo: typeof UserRepository,
    private readonly externalAccountRepo: typeof ExternalAccountRepository,
    private readonly cohortRepo: typeof CohortRepository,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // syncCohorts
  // ---------------------------------------------------------------------------

  /**
   * Import Google Workspace student OUs as Cohort rows.
   *
   * Calls listOUs(studentRoot) and for each child OU calls
   * CohortService.upsertByOUPath to create or update the local Cohort row.
   *
   * @param actorId - The user performing this action; null for system.
   * @param tx      - Optional Prisma transaction client.
   * @returns WorkspaceSyncReport with cohortsUpserted count.
   */
  async syncCohorts(
    actorId: number | null = null,
    tx?: any,
  ): Promise<WorkspaceSyncReport> {
    const db = tx ?? this.prisma;
    const studentRoot = process.env.GOOGLE_STUDENT_OU_ROOT ?? '/Students';

    logger.info({ studentRoot, actorId }, '[workspace-sync] syncCohorts: starting');

    const ous = await this.googleClient.listOUs(studentRoot);
    let cohortsUpserted = 0;

    for (const ou of ous) {
      await this.cohortService.upsertByOUPath(ou.orgUnitPath, ou.name, actorId);
      cohortsUpserted++;
    }

    await this.audit.record(db, {
      actor_user_id: actorId,
      action: 'sync_cohorts_completed',
      details: { student_root: studentRoot, cohorts_upserted: cohortsUpserted },
    });

    logger.info(
      { studentRoot, cohortsUpserted },
      '[workspace-sync] syncCohorts: completed',
    );

    return { cohortsUpserted };
  }

  // ---------------------------------------------------------------------------
  // syncStaff
  // ---------------------------------------------------------------------------

  /**
   * Import Google Workspace staff OU users as staff User rows.
   *
   * Skips (returns informational report) if GOOGLE_STAFF_OU_PATH is unset.
   * For each user: if the local User does not exist, creates with role=staff,
   * created_via=workspace_sync. If it exists and role is not admin, sets
   * role=staff. Never downgrades admin.
   *
   * @param actorId - The user performing this action; null for system.
   * @param tx      - Optional Prisma transaction client.
   * @returns WorkspaceSyncReport with staffUpserted count.
   */
  async syncStaff(
    actorId: number | null = null,
    tx?: any,
  ): Promise<WorkspaceSyncReport> {
    const db = tx ?? this.prisma;
    const staffOuPath = process.env.GOOGLE_STAFF_OU_PATH;

    if (!staffOuPath) {
      logger.info(
        '[workspace-sync] syncStaff: GOOGLE_STAFF_OU_PATH is not set — skipping',
      );
      await this.audit.record(db, {
        actor_user_id: actorId,
        action: 'sync_staff_completed',
        details: { skipped: true, reason: 'GOOGLE_STAFF_OU_PATH not set' },
      });
      return { staffUpserted: 0 };
    }

    logger.info({ staffOuPath, actorId }, '[workspace-sync] syncStaff: starting');

    const wsUsers = await this.googleClient.listUsersInOU(staffOuPath);
    let staffUpserted = 0;

    for (const wsUser of wsUsers) {
      const existing = await this.userRepo.findByEmail(db, wsUser.primaryEmail);

      if (!existing) {
        await this.userRepo.create(db, {
          primary_email: wsUser.primaryEmail,
          display_name: wsUser.primaryEmail,
          role: 'staff',
          created_via: 'workspace_sync',
        });
      } else if (existing.role !== 'admin') {
        if (existing.role !== 'staff') {
          await this.userRepo.update(db, existing.id, { role: 'staff' });
        }
      }
      // admin role is never touched

      staffUpserted++;
    }

    await this.audit.record(db, {
      actor_user_id: actorId,
      action: 'sync_staff_completed',
      details: { staff_ou_path: staffOuPath, staff_upserted: staffUpserted },
    });

    logger.info(
      { staffOuPath, staffUpserted },
      '[workspace-sync] syncStaff: completed',
    );

    return { staffUpserted };
  }

  // ---------------------------------------------------------------------------
  // syncStudents
  // ---------------------------------------------------------------------------

  /**
   * Import Google Workspace student OU users as student User rows.
   *
   * Sequence:
   *  1. Fetch root-level students (listUsersInOU(studentRoot)) — these get
   *     cohort_id=null.
   *  2. For each Cohort with a non-null google_ou_path, fetch users in that OU
   *     and upsert them with cohort_id=cohort.id.
   *  3. Collect all seen emails. For every workspace ExternalAccount whose
   *     user email was NOT seen, set status=removed and record a
   *     workspace_sync_flagged audit event.
   *
   * Role rules: sets role=student unless the user is already admin (preserved).
   * Does not overwrite staff role — students sync does not touch staff.
   *
   * @param actorId - The user performing this action; null for system.
   * @param tx      - Optional Prisma transaction client.
   * @returns WorkspaceSyncReport with studentsUpserted count and flaggedAccounts.
   */
  async syncStudents(
    actorId: number | null = null,
    tx?: any,
  ): Promise<WorkspaceSyncReport> {
    const db = tx ?? this.prisma;
    const studentRoot = process.env.GOOGLE_STUDENT_OU_ROOT ?? '/Students';

    logger.info({ studentRoot, actorId }, '[workspace-sync] syncStudents: starting');

    const seenEmails = new Set<string>();
    let studentsUpserted = 0;

    // 1. Root-level students (no cohort assignment)
    const rootUsers = await this.googleClient.listUsersInOU(studentRoot);
    for (const wsUser of rootUsers) {
      await this._upsertStudent(db, wsUser.primaryEmail, null, actorId);
      seenEmails.add(wsUser.primaryEmail);
      studentsUpserted++;
    }

    // 2. Per-cohort students
    const cohorts = await this.cohortRepo.findAllWithOUPath(db);
    for (const cohort of cohorts) {
      const cohortUsers = await this.googleClient.listUsersInOU(cohort.google_ou_path!);
      for (const wsUser of cohortUsers) {
        await this._upsertStudent(db, wsUser.primaryEmail, cohort.id, actorId);
        seenEmails.add(wsUser.primaryEmail);
        studentsUpserted++;
      }
    }

    // 3. Flag workspace ExternalAccounts whose email was not seen
    const flaggedAccounts = await this._flagRemovedWorkspaceAccounts(
      db,
      seenEmails,
      actorId,
    );

    await this.audit.record(db, {
      actor_user_id: actorId,
      action: 'sync_students_completed',
      details: {
        student_root: studentRoot,
        students_upserted: studentsUpserted,
        flagged_count: flaggedAccounts.length,
      },
    });

    logger.info(
      { studentRoot, studentsUpserted, flaggedCount: flaggedAccounts.length },
      '[workspace-sync] syncStudents: completed',
    );

    return { studentsUpserted, flaggedAccounts };
  }

  // ---------------------------------------------------------------------------
  // syncAll
  // ---------------------------------------------------------------------------

  /**
   * Run syncCohorts → syncStaff → syncStudents in sequence.
   *
   * Each sub-operation failure is caught and recorded in the report. Remaining
   * operations still run (fail-soft).
   *
   * @param actorId - The user performing this action; null for system.
   * @param tx      - Optional Prisma transaction client.
   * @returns Combined WorkspaceSyncReport.
   */
  async syncAll(
    actorId: number | null = null,
    tx?: any,
  ): Promise<WorkspaceSyncReport> {
    const db = tx ?? this.prisma;
    const combined: WorkspaceSyncReport = {
      cohortsUpserted: 0,
      staffUpserted: 0,
      studentsUpserted: 0,
      flaggedAccounts: [],
      errors: [],
    };

    logger.info({ actorId }, '[workspace-sync] syncAll: starting');

    // syncCohorts
    try {
      const r = await this.syncCohorts(actorId, tx);
      combined.cohortsUpserted = r.cohortsUpserted ?? 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[workspace-sync] syncAll: syncCohorts failed');
      combined.errors!.push({ operation: 'syncCohorts', error: msg });
    }

    // syncStaff
    try {
      const r = await this.syncStaff(actorId, tx);
      combined.staffUpserted = r.staffUpserted ?? 0;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[workspace-sync] syncAll: syncStaff failed');
      combined.errors!.push({ operation: 'syncStaff', error: msg });
    }

    // syncStudents
    try {
      const r = await this.syncStudents(actorId, tx);
      combined.studentsUpserted = r.studentsUpserted ?? 0;
      combined.flaggedAccounts = r.flaggedAccounts ?? [];
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error({ err }, '[workspace-sync] syncAll: syncStudents failed');
      combined.errors!.push({ operation: 'syncStudents', error: msg });
    }

    await this.audit.record(db, {
      actor_user_id: actorId,
      action: 'sync_all_completed',
      details: {
        cohorts_upserted: combined.cohortsUpserted,
        staff_upserted: combined.staffUpserted,
        students_upserted: combined.studentsUpserted,
        flagged_count: combined.flaggedAccounts!.length,
        error_count: combined.errors!.length,
      },
    });

    logger.info(
      {
        cohortsUpserted: combined.cohortsUpserted,
        staffUpserted: combined.staffUpserted,
        studentsUpserted: combined.studentsUpserted,
        flaggedAccounts: combined.flaggedAccounts!.length,
        errors: combined.errors!.length,
      },
      '[workspace-sync] syncAll: completed',
    );

    return combined;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Upsert a student user by email.
   * - If the user does not exist, create with role=student, created_via=workspace_sync.
   * - If the user exists and role is admin, leave role unchanged.
   * - If the user exists with any other role, set role=student and cohort_id.
   */
  private async _upsertStudent(
    db: any,
    primaryEmail: string,
    cohortId: number | null,
    actorId: number | null,
  ): Promise<void> {
    const existing = await this.userRepo.findByEmail(db, primaryEmail);

    if (!existing) {
      await this.userRepo.create(db, {
        primary_email: primaryEmail,
        display_name: primaryEmail,
        role: 'student',
        created_via: 'workspace_sync',
        cohort_id: cohortId,
      });
      return;
    }

    // Preserve admin role, but update cohort_id
    if (existing.role === 'admin') {
      if (existing.cohort_id !== cohortId) {
        await this.userRepo.update(db, existing.id, { cohort_id: cohortId });
      }
      return;
    }

    // For staff/student: set role=student and cohort_id
    const needsUpdate =
      existing.role !== 'student' || existing.cohort_id !== cohortId;
    if (needsUpdate) {
      await this.userRepo.update(db, existing.id, {
        role: 'student',
        cohort_id: cohortId,
      });
    }
  }

  /**
   * For every workspace ExternalAccount whose user's primary_email is NOT in
   * seenEmails, set status=removed and record a workspace_sync_flagged audit
   * event.
   *
   * Returns the list of flagged emails.
   */
  private async _flagRemovedWorkspaceAccounts(
    db: any,
    seenEmails: Set<string>,
    actorId: number | null,
  ): Promise<string[]> {
    // Find all active/pending workspace ExternalAccounts
    const activeAccounts = await (db as any).externalAccount.findMany({
      where: {
        type: 'workspace',
        status: { in: ['pending', 'active'] },
      },
      include: { user: { select: { primary_email: true } } },
    });

    const flagged: string[] = [];

    for (const account of activeAccounts) {
      const email: string = account.user.primary_email;
      if (!seenEmails.has(email)) {
        await this.externalAccountRepo.updateStatus(db, account.id, 'removed');
        await this.audit.record(db, {
          actor_user_id: actorId,
          action: 'workspace_sync_flagged',
          target_user_id: account.user_id,
          target_entity_type: 'ExternalAccount',
          target_entity_id: String(account.id),
          details: { primary_email: email },
        });
        flagged.push(email);
      }
    }

    return flagged;
  }
}
