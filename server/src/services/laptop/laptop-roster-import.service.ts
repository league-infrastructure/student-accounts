/**
 * LaptopRosterImportService — one-time import of the laptop roster
 * (sprint 002 "laptop accounts" T003, SUC-001).
 *
 * For every `students/<id>/config.json` in the roster bucket, create a user
 * here with that username and the `$6$` password hash as-is, a `username`
 * Login row (the same representation passphrase signup uses), membership in
 * a named group (default "Botball 26"), and run the merge scan so duplicates
 * of Google/GitHub users land in the merge queue.
 *
 * Idempotent: an entry whose id is already a username here is `matched` and
 * left alone, so a second run changes nothing.
 *
 * Per entry (never throws; outcomes are counted in the report):
 *  - reserved or malformed id            → skipped
 *  - no config.json behind the prefix    → skipped
 *  - `User.username == id` exists        → matched (nothing changed)
 *  - otherwise                           → created, in one transaction
 *    (User + Login + UserGroup + `create_user` audit); then `mergeScan(user)`
 *    outside the transaction, its errors swallowed into `details[].reason`.
 *  - an entry without a `$`-prefixed `password_hash` is still created, with
 *    both hashes null (`reason: 'no usable hash'`); the student cannot sign
 *    in until an admin sets a password.
 *
 * `listIds()` failing (including LaptopRosterNotConfiguredError) propagates:
 * without the list there is nothing to import, and the route maps the
 * not-configured case to 503.
 */

import { createLogger } from '../logger.js';
import type { AuditService } from '../audit.service.js';
import type { GroupService } from '../group.service.js';
import { GroupRepository } from '../repositories/group.repository.js';
import type { RosterClient, RosterEntry } from './laptop-roster.client.js';
import { isValidRosterId, RESERVED_ROSTER_IDS } from './roster-ids.js';
import type { Group, User } from '../../generated/prisma/client.js';

const logger = createLogger('laptop-roster-import');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export const DEFAULT_IMPORT_GROUP_NAME = 'Botball 26';

/** Domain of the synthesised, undeliverable address imported users get. */
export const LAPTOP_IMPORT_EMAIL_DOMAIN = 'laptop.invalid';

export type ImportOutcome = 'created' | 'matched' | 'skipped' | 'error';

export interface ImportDetail {
  id: string;
  outcome: ImportOutcome;
  reason?: string;
}

export interface ImportReport {
  created: number;
  matched: number;
  skipped: number;
  errors: number;
  details: ImportDetail[];
}

export type MergeScanFn = (user: User) => Promise<void>;

/** Synthesised primary_email for an imported roster id. */
export function laptopImportEmail(id: string): string {
  return `${id}@${LAPTOP_IMPORT_EMAIL_DOMAIN}`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LaptopRosterImportService {
  constructor(
    private readonly roster: RosterClient,
    private readonly prisma: any,
    private readonly groupService: GroupService,
    private readonly audit: AuditService,
    private readonly mergeScan: MergeScanFn,
  ) {}

  /**
   * Import every roster entry into the named group.
   *
   * @param actorId  the admin running the import, or null for the script.
   * @param opts.groupName  group to add imported users to; created if missing.
   */
  async importAll(
    actorId: number | null,
    opts: { groupName: string },
  ): Promise<ImportReport> {
    const groupName = (opts.groupName ?? '').trim() || DEFAULT_IMPORT_GROUP_NAME;
    const report: ImportReport = { created: 0, matched: 0, skipped: 0, errors: 0, details: [] };

    logger.info({ groupName }, '[laptop-import] Starting laptop roster import.');

    // Let listIds() errors propagate: nothing can be imported without the list.
    const ids = await this.roster.listIds();
    const group = await this.ensureGroup(groupName, actorId);

    for (const id of ids) {
      await this.processEntry(id, group, actorId, report);
    }

    await this.recordSummary(actorId, groupName, report);

    logger.info(
      { created: report.created, matched: report.matched, skipped: report.skipped, errors: report.errors },
      '[laptop-import] Import complete.',
    );
    return report;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /** Find the target group by name, creating it when missing. */
  private async ensureGroup(groupName: string, actorId: number | null): Promise<Group> {
    const existing = await GroupRepository.findByName(this.prisma, groupName);
    if (existing) return existing;

    const description = 'Imported from the laptop roster';
    if (actorId !== null) {
      // Admin-run: GroupService records the standard create_group audit.
      return this.groupService.create({ name: groupName, description }, actorId);
    }
    // Script-run (no actor): same rows, audit with a null actor.
    return this.prisma.$transaction(async (tx: any) => {
      const { group } = await GroupRepository.upsertByName(tx, groupName, description);
      await this.audit.record(tx, {
        actor_user_id: null,
        action: 'create_group',
        target_entity_type: 'Group',
        target_entity_id: String(group.id),
        details: { name: groupName, description, source: 'laptop_import' },
      });
      return group;
    });
  }

  /** Classify and process one roster id. Updates `report` in place; never throws. */
  private async processEntry(
    id: string,
    group: Group,
    actorId: number | null,
    report: ImportReport,
  ): Promise<void> {
    if (!isValidRosterId(id)) {
      const reason = RESERVED_ROSTER_IDS.has(id) ? 'reserved id' : 'malformed id';
      logger.warn({ id, reason }, '[laptop-import] Skipping entry.');
      report.skipped++;
      report.details.push({ id, outcome: 'skipped', reason });
      return;
    }

    try {
      const entry = await this.roster.read(id);
      if (!entry) {
        report.skipped++;
        report.details.push({ id, outcome: 'skipped', reason: 'no config.json' });
        return;
      }

      const existing = await this.prisma.user.findUnique({ where: { username: id } });
      if (existing) {
        report.matched++;
        report.details.push({
          id,
          outcome: 'matched',
          ...(existing.laptop_password_hash
            ? {}
            : { reason: 'existing user has no laptop-compatible hash' }),
        });
        return;
      }

      const hash = usableHash(entry);
      const user = await this.createUser(id, entry, hash, group, actorId);

      const detail: ImportDetail = { id, outcome: 'created' };
      if (hash === null) detail.reason = 'no usable hash';

      // Merge scan outside the transaction; a failure must not undo the import.
      try {
        await this.mergeScan(user);
      } catch (err) {
        logger.error({ err, userId: user.id }, '[laptop-import] mergeScan error (non-fatal).');
        const msg = `merge scan failed: ${errorMessage(err)}`;
        detail.reason = detail.reason ? `${detail.reason}; ${msg}` : msg;
      }

      report.created++;
      report.details.push(detail);
      logger.info({ id, userId: user.id }, '[laptop-import] Created user.');
    } catch (err) {
      logger.error({ err, id }, '[laptop-import] Error importing entry.');
      report.errors++;
      report.details.push({ id, outcome: 'error', reason: errorMessage(err) });
    }
  }

  /** Create User + Login + group membership + audit in one transaction. */
  private async createUser(
    id: string,
    entry: RosterEntry,
    hash: string | null,
    group: Group,
    actorId: number | null,
  ): Promise<User> {
    return this.prisma.$transaction(async (tx: any) => {
      const user: User = await tx.user.create({
        data: {
          username: id,
          display_name: (entry.display_name ?? '').trim() || id,
          password_hash: hash,
          laptop_password_hash: hash,
          role: 'student',
          created_via: 'laptop_import',
          approval_status: 'approved',
          is_active: true,
          primary_email: laptopImportEmail(id),
          allows_llm_proxy: true,
        },
      });

      await tx.login.create({
        data: {
          user_id: user.id,
          provider: 'username',
          provider_user_id: `laptop-import:${id}`,
          provider_username: id,
          provider_payload: {
            created: entry.created ?? null,
            created_host: entry.created_host ?? null,
          },
        },
      });

      await GroupRepository.addMember(tx, group.id, user.id);

      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'create_user',
        target_user_id: user.id,
        target_entity_type: 'User',
        target_entity_id: String(user.id),
        details: {
          source: 'laptop_import',
          created_via: 'laptop_import',
          group_id: group.id,
          group_name: group.name,
          has_password_hash: hash !== null,
        },
      });

      return user;
    });
  }

  /** Record the run's totals; failure here is logged, not thrown. */
  private async recordSummary(
    actorId: number | null,
    groupName: string,
    report: ImportReport,
  ): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx: any) => {
        await this.audit.record(tx, {
          actor_user_id: actorId,
          action: 'laptop_roster_imported',
          details: {
            group_name: groupName,
            created: report.created,
            matched: report.matched,
            skipped: report.skipped,
            errors: report.errors,
          },
        });
      });
    } catch (err) {
      logger.error({ err }, '[laptop-import] Failed to record summary audit event.');
    }
  }
}

// ---------------------------------------------------------------------------
// Module helpers
// ---------------------------------------------------------------------------

/**
 * The roster's crypt hash when it is one (`$`-prefixed, as glibc crypt
 * writes it); null for locked (`!`), disabled (`*`), empty or missing.
 */
function usableHash(entry: RosterEntry): string | null {
  const h = entry.password_hash;
  return typeof h === 'string' && h.startsWith('$') ? h : null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
