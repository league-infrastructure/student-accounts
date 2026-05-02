/**
 * WorkspaceSyncService — imports Google Workspace directory state into the
 * local database.
 *
 * This service is the core of the Google Workspace sync epic (SUC-001 through
 * SUC-004). It reads the directory via GoogleWorkspaceAdminClient and upserts
 * local Group, User, and ExternalAccount rows to match.
 *
 * Methods:
 *  - syncCohorts  — import child OUs under GOOGLE_STUDENT_OU_ROOT as Groups.
 *                   (Sprint 025: previously wrote Cohort rows; now writes Group
 *                   rows with the same name. The User.cohort_id column is
 *                   legacy and is NOT modified here — see ticket 004.)
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

import { createLogger } from './logger.js';
import type { AuditService } from './audit.service.js';
import type { GoogleWorkspaceAdminClient } from './google-workspace/google-workspace-admin.client.js';
import { UserRepository } from './repositories/user.repository.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import { CohortRepository } from './repositories/cohort.repository.js';
import { GroupRepository } from './repositories/group.repository.js';

const logger = createLogger('workspace-sync');

// ---------------------------------------------------------------------------
// Report types
// ---------------------------------------------------------------------------

export interface WorkspaceSyncReport {
  /**
   * Count of Group rows created or updated by syncCohorts.
   * (Sprint 025: renamed from cohortsUpserted — OUs now sync as Groups.)
   */
  groupsUpserted?: number;
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
    private readonly userRepo: typeof UserRepository,
    private readonly externalAccountRepo: typeof ExternalAccountRepository,
    private readonly cohortRepo: typeof CohortRepository,
    private readonly audit: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // syncCohorts
  // ---------------------------------------------------------------------------

  /**
   * Import Google Workspace student OUs as Group rows.
   *
   * Sprint 025 (ticket 004): previously this method wrote Cohort rows via
   * CohortService.upsertByOUPath. As of sprint 025 the cohort concept is
   * being dropped at the top-level UI; OUs now sync as Groups with the same
   * name. Existing Cohort rows and User.cohort_id assignments are NOT touched
   * here — that migration is deferred.
   *
   * Calls listOUs(studentRoot) and for each child OU calls
   * GroupRepository.upsertByName to create or update the local Group row.
   *
   * @param actorId - The user performing this action; null for system.
   * @param tx      - Optional Prisma transaction client.
   * @returns WorkspaceSyncReport with groupsUpserted count.
   */
  async syncCohorts(
    actorId: number | null = null,
    tx?: any,
  ): Promise<WorkspaceSyncReport> {
    const db = tx ?? this.prisma;
    const studentRoot = process.env.GOOGLE_STUDENT_OU_ROOT ?? '/Students';

    logger.info({ studentRoot, actorId }, '[workspace-sync] syncCohorts: starting');

    const ous = await this.googleClient.listOUs(studentRoot);
    let groupsUpserted = 0;

    for (const ou of ous) {
      const { created } = await GroupRepository.upsertByName(
        db,
        ou.name,
        `Synced from Google Workspace OU ${ou.orgUnitPath}`,
      );
      if (created) {
        await this.audit.record(db, {
          actor_user_id: actorId,
          action: 'create_group',
          target_entity_type: 'Group',
          details: { name: ou.name, source: 'workspace_sync', ou_path: ou.orgUnitPath },
        });
      }
      groupsUpserted++;
    }

    await this.audit.record(db, {
      actor_user_id: actorId,
      action: 'sync_cohorts_completed',
      details: { student_root: studentRoot, groups_upserted: groupsUpserted },
    });

    logger.info(
      { studentRoot, groupsUpserted },
      '[workspace-sync] syncCohorts: completed',
    );

    return { groupsUpserted };
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

    const seenEmails = new Set<string>();
    for (const wsUser of wsUsers) {
      // Skip suspended Google accounts — they're deactivated below.
      if (wsUser.suspended) continue;

      seenEmails.add(wsUser.primaryEmail);
      const existing = await this.userRepo.findByEmail(db, wsUser.primaryEmail);

      if (!existing) {
        await this.userRepo.create(db, {
          primary_email: wsUser.primaryEmail,
          display_name: wsUser.fullName ?? wsUser.primaryEmail,
          role: 'staff',
          created_via: 'workspace_sync',
        });
      } else {
        const patch: any = {};
        if (existing.is_active === false) patch.is_active = true;
        if (existing.role !== 'admin' && existing.role !== 'staff') {
          patch.role = 'staff';
        }
        if (Object.keys(patch).length > 0) {
          await this.userRepo.update(db, existing.id, patch);
        }
      }
      staffUpserted++;
    }

    // Deactivate staff Users whose Google account is no longer live in the
    // staff OU (suspended, moved to /graveyard, or deleted).
    await this._deactivateNotSeen(db, 'staff', seenEmails, actorId);

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
      if (wsUser.suspended) continue; // deactivated by the not-seen pass
      await this._upsertUserFromWorkspace(db, wsUser, null, actorId);
      seenEmails.add(wsUser.primaryEmail);
      studentsUpserted++;
    }

    // 2. Per-cohort students
    const cohorts = await this.cohortRepo.findAllWithOUPath(db);
    for (const cohort of cohorts) {
      const cohortUsers = await this.googleClient.listUsersInOU(cohort.google_ou_path!);
      for (const wsUser of cohortUsers) {
        if (wsUser.suspended) continue;
        await this._upsertUserFromWorkspace(db, wsUser, cohort.id, actorId);
        seenEmails.add(wsUser.primaryEmail);
        studentsUpserted++;
      }
    }

    // 3a. Flag workspace ExternalAccounts whose email was not seen
    const flaggedAccounts = await this._flagRemovedWorkspaceAccounts(
      db,
      seenEmails,
      actorId,
    );

    // 3b. Soft-delete student Users whose Google account is no longer live
    //     (suspended, moved to /graveyard, or deleted from Google).
    await this._deactivateNotSeen(db, 'student', seenEmails, actorId);

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
      groupsUpserted: 0,
      staffUpserted: 0,
      studentsUpserted: 0,
      flaggedAccounts: [],
      errors: [],
    };

    logger.info({ actorId }, '[workspace-sync] syncAll: starting');

    // syncCohorts
    try {
      const r = await this.syncCohorts(actorId, tx);
      combined.groupsUpserted = r.groupsUpserted ?? 0;
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
        groups_upserted: combined.groupsUpserted,
        staff_upserted: combined.staffUpserted,
        students_upserted: combined.studentsUpserted,
        flagged_count: combined.flaggedAccounts!.length,
        error_count: combined.errors!.length,
      },
    });

    logger.info(
      {
        groupsUpserted: combined.groupsUpserted,
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
   * Derive role from primary_email domain:
   *  - @students.jointheleague.org → student
   *  - @jointheleague.org          → staff (any other subdomain stays staff)
   *  - anything else               → student (fallback)
   *
   * Presence in the /Students OU is not sufficient to call someone a
   * student — legacy @jointheleague.org staff accounts sometimes sit
   * there too and get mis-labeled otherwise.
   */
  private _roleForEmail(primaryEmail: string): 'student' | 'staff' {
    const e = primaryEmail.toLowerCase();
    if (/@students\.jointheleague\.org$/.test(e)) return 'student';
    if (/@jointheleague\.org$/.test(e)) return 'staff';
    return 'student';
  }

  /**
   * Upsert a user synced from a Google Workspace OU. Role is chosen from
   * the email domain (see _roleForEmail), NOT from which OU they were
   * listed in — /Students can contain legacy staff emails that shouldn't
   * be re-labeled as students.
   *
   * - If the user does not exist, create with the domain-derived role.
   * - If the user has role=admin, preserve it (admin is sticky).
   * - Otherwise set role to the domain-derived role.
   * - cohort_id is assigned only when the derived role is student.
   */
  private async _upsertUserFromWorkspace(
    db: any,
    wsUser: { primaryEmail: string; fullName?: string | null },
    cohortId: number | null,
    actorId: number | null,
  ): Promise<void> {
    const primaryEmail = wsUser.primaryEmail;
    const derivedRole = this._roleForEmail(primaryEmail);
    // Only assign a cohort to actual students.
    const targetCohortId = derivedRole === 'student' ? cohortId : null;

    const existing = await this.userRepo.findByEmail(db, primaryEmail);

    if (!existing) {
      await this.userRepo.create(db, {
        primary_email: primaryEmail,
        display_name: wsUser.fullName ?? primaryEmail,
        role: derivedRole,
        created_via: 'workspace_sync',
        cohort_id: targetCohortId,
      });
      return;
    }

    // Re-activate any previously soft-deleted user that's now back in Google.
    const patch: any = {};
    if (existing.is_active === false) patch.is_active = true;

    if (existing.role === 'admin') {
      // Preserve admin role. Only touch cohort_id.
      if (existing.cohort_id !== targetCohortId) patch.cohort_id = targetCohortId;
      if (Object.keys(patch).length > 0) {
        await this.userRepo.update(db, existing.id, patch);
      }
      return;
    }

    if (existing.role !== derivedRole) patch.role = derivedRole;
    if (existing.cohort_id !== targetCohortId) patch.cohort_id = targetCohortId;
    if (Object.keys(patch).length > 0) {
      await this.userRepo.update(db, existing.id, patch);
    }
  }

  /**
   * Soft-delete (is_active=false) every active User of the given role whose
   * primary_email is NOT in seenEmails AND who was either imported from
   * Google sync (created_via='workspace_sync') OR has a @*.jointheleague.org
   * email. This catches users whose Google accounts were suspended / moved
   * to /graveyard / deleted since the last sync. Admin role is never touched.
   */
  private async _deactivateNotSeen(
    db: any,
    role: 'student' | 'staff',
    seenEmails: Set<string>,
    actorId: number | null,
  ): Promise<void> {
    const candidates: any[] = await (db as any).user.findMany({
      where: {
        role,
        is_active: true,
        OR: [
          { created_via: 'workspace_sync' },
          { primary_email: { endsWith: '@jointheleague.org' } },
          { primary_email: { endsWith: '.jointheleague.org' } },
        ],
      },
      select: { id: true, primary_email: true },
    });

    for (const u of candidates) {
      if (seenEmails.has(u.primary_email)) continue;
      await (db as any).user.update({
        where: { id: u.id },
        data: { is_active: false },
      });
      await this.audit.record(db, {
        actor_user_id: actorId,
        action: 'user_deactivated_by_sync',
        target_user_id: u.id,
        target_entity_type: 'User',
        target_entity_id: String(u.id),
        details: { primary_email: u.primary_email, role, reason: 'google_account_gone' },
      });
    }
  }

  /**
   * For every active/pending workspace ExternalAccount whose League email
   * (stored in `external_id`) is NOT present in `seenEmails`, flag the
   * ExternalAccount as removed and record a workspace_sync_flagged audit
   * event.
   *
   * Does NOT deactivate the User row. Losing a League seat doesn't revoke
   * the person's ability to sign in with their external identity — the
   * User record is a login identity, while the ExternalAccount is the
   * per-service seat that can come and go.
   *
   * Returns the list of flagged League emails.
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
      include: { user: { select: { id: true, primary_email: true } } },
    });

    const flagged: string[] = [];

    for (const account of activeAccounts) {
      // `external_id` on workspace rows is the League email (the field
      // that actually shows up in Google's directory), so that's what we
      // compare against `seenEmails`. The user's primary_email may be an
      // external gmail and is never the right key here.
      const leagueEmail: string | null = account.external_id ?? null;
      if (!leagueEmail || seenEmails.has(leagueEmail)) continue;

      await this.externalAccountRepo.updateStatus(db, account.id, 'removed');
      await this.audit.record(db, {
        actor_user_id: actorId,
        action: 'workspace_sync_flagged',
        target_user_id: account.user_id,
        target_entity_type: 'ExternalAccount',
        target_entity_id: String(account.id),
        details: { league_email: leagueEmail, primary_email: account.user.primary_email },
      });

      flagged.push(leagueEmail);
    }

    return flagged;
  }
}
