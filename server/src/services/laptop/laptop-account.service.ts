/**
 * LaptopAccountService — write-back of laptop logins to the roster
 * (sprint 002 "laptop accounts" T004, SUC-002 / SUC-007).
 *
 * After the one-time import this app is the source of truth for laptop
 * logins: the laptops keep reading `students/<id>/config.json` from Spaces
 * at login, so this service writes that object for every user who should
 * be able to log in and locks it (`password_hash: "!"`) for everyone who
 * once could but no longer should. Entries are never deleted: `drive/`
 * next to `config.json` is the student's synced work.
 *
 * Who has a laptop account (`desiredEntry`): the laptop login IS the account's
 * username and password, there is no separate switch and no role exclusion
 * (admins included):
 *   is_active && username && laptop_password_hash && isValidRosterId(username)
 *
 * `reconcile(userId)` is the single entry point called after every change
 * that can affect the entry: password set/changed, username set,
 * display-name change, deactivate/reactivate, merge approval,
 * and from the hourly `laptop-roster-push` job. It reads the existing entry
 * first so `created` / `created_host` survive, writes only when
 * `password_hash` or `display_name` differ, and NEVER throws: a Spaces
 * failure logs, sets `User.laptop_roster_dirty = true` for the job to retry,
 * and returns 'failed'. Spaces being down must not block a password change.
 *
 * `stateFor(user)` (T006, SUC-006 / SUC-007) is the pure read-side companion:
 * it classifies a user row into the laptop-login state the Account page and
 * the admin detail panel show, without touching the roster.
 */

import { createLogger } from '../logger.js';
import type { AuditService } from '../audit.service.js';
import {
  LaptopRosterNotConfiguredError,
  type RosterClient,
  type RosterEntry,
} from './laptop-roster.client.js';
import { isValidRosterId } from './roster-ids.js';

const logger = createLogger('laptop-account');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** `created_host` for entries this app creates (the laptops write their hostname). */
export const STUDENT_ACCOUNTS_HOST = 'student-accounts';

/** `managed_by` marker on every entry this app writes. */
export const MANAGED_BY = 'student-accounts';

/** Locked password field; `league-helper` refuses to log such a user in. */
export const LOCKED_HASH = '!';

/** Error messages for the username rules (shared by every set-username path). */
export const LAPTOP_USERNAME_RULES_MESSAGE =
  'Usernames for laptop login are 3-32 characters: lowercase letters, digits and dashes, starting with a letter or digit.';
export const LAPTOP_USERNAME_TAKEN_MESSAGE =
  'That username is already used on the League laptops by someone else.';

/** The User columns `desiredEntry` looks at. */
export interface LaptopUser {
  id: number;
  username: string | null;
  display_name: string;
  laptop_password_hash: string | null;
  is_active: boolean;
}

/**
 * What one `reconcile` did:
 *  - written    — a usable entry was created or updated
 *  - locked     — the entry was (re)written with `!`
 *  - unchanged  — the roster already matched
 *  - skipped    — nothing to write (no username, invalid id, never had an entry)
 *  - failed     — a read or write failed; the user is marked dirty
 */
export type ReconcileOutcome = 'written' | 'locked' | 'unchanged' | 'skipped' | 'failed';

export interface PushAllResult {
  written: number;
  locked: number;
  unchanged: number;
  skipped: number;
  failed: number;
}

/**
 * What a user sees about their laptop login (T006). Derived from the row alone
 * — the server cannot read the laptops' view, so this is "what the roster
 * entry should be", not "what it is"; `dirty` says whether the two may differ.
 *
 *  - ready            — eligible: an unlocked entry with the crypt hash
 *  - disabled         — `is_active` false (account deactivated or denied);
 *                       the entry, if any, is locked with `!`
 *  - needs_password   — no `laptop_password_hash`: social-login or
 *                       passphrase-only users until they set a password here
 *  - invalid_username — no username, or one the laptops cannot use
 *                       (`isValidRosterId` fails: mixed case, too short,
 *                       reserved…)
 *
 * Checks run in that order (disabled, needs_password,
 * invalid_username) so the user is told about the first thing that blocks
 * them; the remaining case is exactly `isEligible(user)`.
 */
export type LaptopLoginState = 'ready' | 'disabled' | 'needs_password' | 'invalid_username';

export interface LaptopLoginView {
  /** True when the laptop login works right now (state === 'ready'). */
  enabled: boolean;
  state: LaptopLoginState;
  username: string | null;
  /** True when the last roster write failed and the hourly job will retry. */
  dirty: boolean;
  /** ISO timestamp of the last successful roster write or lock, when known. */
  lastWritten?: string;
}

/** The User columns `stateFor` looks at. */
export type LaptopStateUser = LaptopUser & { laptop_roster_dirty: boolean };

/** Classify a user row; see `LaptopLoginState` for the mapping. Pure. */
export function laptopLoginState(user: LaptopUser): LaptopLoginState {
  if (!user.is_active) return 'disabled';
  if (!user.laptop_password_hash) return 'needs_password';
  if (!user.username || !isValidRosterId(user.username)) return 'invalid_username';
  return 'ready';
}

/** The laptop-login view of a user row. Pure; `lastWritten` is left to the caller. */
export function stateFor(user: LaptopStateUser): LaptopLoginView {
  const state = laptopLoginState(user);
  return {
    enabled: state === 'ready',
    state,
    username: user.username ?? null,
    dirty: !!user.laptop_roster_dirty,
  };
}

/** Audit actions that mean the roster entry was (re)written. */
const ROSTER_WRITE_ACTIONS = ['laptop_roster_written', 'laptop_roster_locked'];

/** Compact ISO-8601 UTC, `20260825T170542Z`, as `league-helper` writes it. */
export function rosterTimestamp(date: Date = new Date()): string {
  return `${date.toISOString().replace(/[-:]/g, '').slice(0, 15)}Z`;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LaptopAccountService {
  constructor(
    private readonly roster: RosterClient,
    private readonly prisma: any,
    private readonly audit: AuditService,
  ) {}

  /** True when `user` should have a usable (unlocked) roster entry. */
  isEligible(user: LaptopUser): boolean {
    return (
      user.is_active &&
      !!user.username &&
      !!user.laptop_password_hash &&
      isValidRosterId(user.username)
    );
  }

  /** See the module-level `stateFor`; exposed on the service for callers holding `req.services`. */
  stateFor(user: LaptopStateUser): LaptopLoginView {
    return stateFor(user);
  }

  /**
   * ISO timestamp of the last `laptop_roster_written` / `laptop_roster_locked`
   * audit event for `userId`, or null when the entry was never written from
   * here (or the lookup fails — this is informational only).
   */
  async lastWrittenAt(userId: number): Promise<string | null> {
    try {
      const event = await this.prisma.auditEvent.findFirst({
        where: { target_user_id: userId, action: { in: ROSTER_WRITE_ACTIONS } },
        orderBy: { created_at: 'desc' },
        select: { created_at: true },
      });
      return event ? new Date(event.created_at).toISOString() : null;
    } catch (err) {
      logger.warn({ err, userId }, '[laptop-account] Could not look up the last roster write.');
      return null;
    }
  }

  /**
   * The entry the roster should hold for `user`, given what it holds now.
   *
   *  - eligible                         → full entry with the crypt hash
   *  - not eligible, but `existing`     → same shape, `password_hash: '!'`
   *  - no username / invalid id / never had an entry → null (nothing to write)
   *
   * `created` and `created_host` are taken from `existing` when present so
   * the laptops' provenance survives; otherwise they are `now` and this app.
   */
  desiredEntry(
    user: LaptopUser,
    existing?: RosterEntry | null,
    now: Date = new Date(),
  ): RosterEntry | null {
    const username = user.username;
    if (!username || !isValidRosterId(username)) return null;

    const eligible = this.isEligible(user);
    if (!eligible && !existing) return null;

    const stamp = rosterTimestamp(now);
    const entry: RosterEntry = {
      id: username,
      display_name: user.display_name,
      password_hash: eligible ? (user.laptop_password_hash as string) : LOCKED_HASH,
      created: existing?.created ?? stamp,
      created_host: existing?.created_host ?? STUDENT_ACCOUNTS_HOST,
      managed_by: MANAGED_BY,
      updated: stamp,
    };
    if (existing?.renamed_from) entry.renamed_from = existing.renamed_from;
    return entry;
  }

  /**
   * Bring the roster entry for `userId` in line with the user row.
   *
   * Never throws. On success `laptop_roster_dirty` is cleared and a
   * `laptop_roster_written` / `laptop_roster_locked` audit event is recorded
   * (actor = `actorId`, null for system). On any roster or database error the
   * user is marked dirty for the hourly job and 'failed' is returned.
   */
  async reconcile(userId: number, actorId: number | null = null): Promise<ReconcileOutcome> {
    let user: (LaptopUser & { laptop_roster_dirty: boolean }) | null;
    try {
      user = await this.prisma.user.findUnique({ where: { id: userId } });
    } catch (err) {
      logger.error({ err, userId }, '[laptop-account] Could not load user for reconcile.');
      return 'failed';
    }
    if (!user) {
      logger.warn({ userId }, '[laptop-account] reconcile: user not found; nothing to write.');
      return 'skipped';
    }

    const username = user.username;
    if (!username || !isValidRosterId(username)) {
      // Nothing can be written under an invalid key, so nothing is pending.
      await this.markClean(user);
      return 'skipped';
    }

    try {
      const existing = await this.roster.read(username);
      const desired = this.desiredEntry(user, existing);
      if (!desired) {
        await this.markClean(user);
        return 'skipped';
      }

      if (
        existing &&
        existing.password_hash === desired.password_hash &&
        existing.display_name === desired.display_name
      ) {
        await this.markClean(user);
        return 'unchanged';
      }

      await this.roster.write(username, desired);
      const outcome: ReconcileOutcome = desired.password_hash === LOCKED_HASH ? 'locked' : 'written';

      await this.prisma.$transaction(async (tx: any) => {
        await tx.user.update({ where: { id: userId }, data: { laptop_roster_dirty: false } });
        await this.audit.record(tx, {
          actor_user_id: actorId,
          action: outcome === 'locked' ? 'laptop_roster_locked' : 'laptop_roster_written',
          target_user_id: userId,
          target_entity_type: 'User',
          target_entity_id: String(userId),
          details: {
            id: username,
            display_name: desired.display_name,
            created_host: desired.created_host,
            existed: existing !== null,
          },
        });
      });

      logger.info({ userId, id: username, outcome }, '[laptop-account] Roster entry reconciled.');
      return outcome;
    } catch (err) {
      const notConfigured = err instanceof LaptopRosterNotConfiguredError;
      logger[notConfigured ? 'warn' : 'error'](
        { err, userId, id: username },
        '[laptop-account] Roster write failed; marking user dirty for the push job.',
      );
      await this.markDirty(userId);
      return 'failed';
    }
  }

  /**
   * Reconcile every user who has a username. Used by the admin "Push all"
   * button after the import and whenever the bucket needs repairing.
   * Database errors listing users propagate; per-user failures are counted.
   */
  async pushAll(actorId: number | null = null): Promise<PushAllResult> {
    const users: Array<{ id: number }> = await this.prisma.user.findMany({
      where: { username: { not: null } },
      select: { id: true },
      orderBy: { id: 'asc' },
    });

    const result: PushAllResult = { written: 0, locked: 0, unchanged: 0, skipped: 0, failed: 0 };
    for (const { id } of users) {
      const outcome = await this.reconcile(id, actorId);
      result[outcome]++;
    }
    logger.info({ ...result, actorId }, '[laptop-account] Push all complete.');
    return result;
  }

  /**
   * True when the roster already has an entry for `username` that does not
   * belong to `userId` here: either another user owns that username, or
   * nobody does (a laptop account that was never imported). Used by the
   * username rules so nobody can take over someone else's laptop login.
   *
   * Fail-open: when the roster cannot be read (not configured, Spaces down)
   * this logs and returns false — an outage must not block account setup.
   */
  async rosterIdTakenByOther(username: string, userId: number | null): Promise<boolean> {
    if (!isValidRosterId(username)) return false;

    let entry: RosterEntry | null;
    try {
      entry = await this.roster.read(username);
    } catch (err) {
      if (!(err instanceof LaptopRosterNotConfiguredError)) {
        logger.error({ err, id: username }, '[laptop-account] Roster read failed; skipping ownership check.');
      }
      return false;
    }
    if (!entry) return false;

    const owner = await this.prisma.user.findUnique({
      where: { username },
      select: { id: true },
    });
    if (!owner) return true;
    return owner.id !== userId;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private async markClean(user: { id: number; laptop_roster_dirty: boolean }): Promise<void> {
    if (!user.laptop_roster_dirty) return;
    try {
      await this.prisma.user.update({ where: { id: user.id }, data: { laptop_roster_dirty: false } });
    } catch (err) {
      logger.error({ err, userId: user.id }, '[laptop-account] Could not clear laptop_roster_dirty.');
    }
  }

  private async markDirty(userId: number): Promise<void> {
    try {
      await this.prisma.user.update({ where: { id: userId }, data: { laptop_roster_dirty: true } });
    } catch (err) {
      logger.error({ err, userId }, '[laptop-account] Could not set laptop_roster_dirty.');
    }
  }
}
