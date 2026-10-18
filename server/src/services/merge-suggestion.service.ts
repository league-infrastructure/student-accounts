/**
 * MergeSuggestionService — full implementation (Sprint 007 T004; merge
 * completeness, manual merge and rule-scan backfill in sprint 002 T008).
 *
 * Provides the administrative workflow for merge suggestions:
 *  - findQueueItems(): pending + deferred suggestions with user summaries
 *  - findDetailById(id): single suggestion with full user data (logins,
 *    external accounts, username / created_via / created_host, active proxy
 *    token summary, group names)
 *  - approve(id, survivorId, actorId): atomic transactional merge that moves
 *    EVERYTHING belonging to the non-survivor (see `approve` for the list)
 *  - manualMerge(userId, otherUserId, survivorId, actorId): admin-initiated
 *    suggestion + approval in one call
 *  - rescan(createdVia): rule-based suggestion backfill
 *  - reject(id, actorId): marks suggestion rejected with audit event
 *  - defer(id): hides suggestion from default queue without deciding
 *
 * MergeConflictError is thrown when an action is attempted on a suggestion
 * that is already in a terminal state (approved or rejected).
 */

import { MergeSuggestionRepository } from './repositories/merge-suggestion.repository.js';
import { AuditService } from './audit.service.js';
import type { MergeSuggestion } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { AppError, ConflictError, NotFoundError } from '../errors.js';
import { ruleScanAll, type RuleScanAllResult } from './auth/merge-scan.service.js';
import type { LaptopAccountService } from './laptop/laptop-account.service.js';
import { createLogger } from './logger.js';

const logger = createLogger('merge-suggestion.service');

/** Rationale on suggestions created by `manualMerge`. */
export const ADMIN_INITIATED_RATIONALE = 'admin-initiated';

/** `primary_email` of a merged-away user: `merged:<survivorId>:<email>`. */
export function parkedEmail(survivorId: number, email: string): string {
  return `merged:${survivorId}:${email}`;
}

/** The `allows_*` flags OR-ed into the survivor on merge. */
const ALLOWS_FLAGS = [
  'allows_oauth_client',
  'allows_llm_proxy',
  'allows_league_account',
  'allows_laptop_account',
] as const;

/** Statuses that occupy the (user_id, type) partial unique index on ExternalAccount. */
const EXTERNAL_ACCOUNT_LIVE_STATUSES = ['pending', 'active'];

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Thrown when an approve/reject/defer action is attempted on a suggestion
 * that is already in a terminal state (approved or rejected), or when
 * the survivor ID does not belong to the suggestion pair.
 */
export class MergeConflictError extends Error {
  readonly code = 'MERGE_CONFLICT';
  constructor(message: string) {
    super(message);
    this.name = 'MergeConflictError';
  }
}

// ---------------------------------------------------------------------------
// Queue / detail projection types
// ---------------------------------------------------------------------------

/** Lightweight user summary included in queue items. */
export interface UserSummary {
  id: number;
  display_name: string;
  primary_email: string;
}

/** A merge suggestion as it appears in the admin queue. */
export interface MergeSuggestionQueueItem {
  id: number;
  user_a: UserSummary;
  user_b: UserSummary;
  haiku_confidence: number;
  haiku_rationale: string | null;
  status: string;
  created_at: Date;
}

/** One side of a suggestion in the detail view. */
export interface MergeUserDetail {
  id: number;
  display_name: string;
  primary_email: string;
  cohort_id: number | null;
  is_active: boolean;
  /** Login username (also the laptop login id), null when unset. */
  username: string | null;
  created_via: string;
  /** `created_host` from the `username` Login's provider_payload (the laptop that created the roster entry), else null. */
  created_host: string | null;
  /** Active (non-revoked, non-expired) LLM proxy token, or null. */
  llm_proxy_token: { tokens_used: number; token_limit: number } | null;
  /** Names of the groups the user belongs to. */
  groups: string[];
  logins: { id: number; provider: string; provider_email: string | null }[];
  external_accounts: { id: number; type: string; status: string }[];
}

/** Full suggestion record with complete user data for the detail view. */
export interface MergeSuggestionDetail {
  id: number;
  user_a: MergeUserDetail;
  user_b: MergeUserDetail;
  haiku_confidence: number;
  haiku_rationale: string | null;
  status: string;
  decided_by: number | null;
  decided_at: Date | null;
  created_at: Date;
}

/**
 * Everything `approve` moved, dropped or changed. Also the `details` payload
 * of the `merge_approve` audit event.
 */
export interface MergeOutcome {
  survivor_id: number;
  non_survivor_id: number;
  /** Same as survivor_id; recorded so the audit row answers "merged into whom?". */
  merged_into: number;
  /** The non-survivor's new primary_email (`merged:<survivorId>:<email>`). */
  parked_email: string;
  logins_moved: number;
  external_accounts_moved: number;
  /** Non-survivor rows marked `removed` because the survivor had a live row of the same type. */
  external_accounts_removed: { id: number; type: string }[];
  groups_moved: string[];
  /** Memberships the survivor already had (non-survivor's row dropped). */
  groups_skipped: string[];
  /** 'moved': non-survivor's active token now belongs to the survivor; 'revoked': survivor kept its own. */
  llm_proxy_token: 'moved' | 'revoked' | 'none';
  /** Usage added to the survivor's token when the non-survivor's was revoked. */
  llm_proxy_usage_carried: { tokens_used: number; request_count: number } | null;
  /** Other (revoked / expired) token rows re-pointed for history. */
  llm_proxy_tokens_repointed: number;
  username: { taken: string } | { dropped: string; kept: string } | null;
  password_hash_taken: boolean;
  laptop_password_hash_taken: boolean;
  /** `allows_*` flags that became true on the survivor because of the merge. */
  flags_set: string[];
  cohort_inherited: number | null;
  oauth_consents_moved: number;
  /** Consents dropped because the survivor had already consented to the same client. */
  oauth_consents_dropped: number;
  oauth_access_tokens_moved: number;
  oauth_refresh_tokens_moved: number;
  oauth_authorization_codes_moved: number;
  provisioning_requests_moved: number;
  provisioning_decisions_moved: number;
  audit_events_repointed: { actor: number; target: number };
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class MergeSuggestionService {
  private audit: AuditService;

  /**
   * @param prisma         - Prisma client.
   * @param audit          - AuditService (default: a fresh instance).
   * @param laptopAccounts - When given, `approve` (owning its transaction)
   *                         reconciles the laptop roster for both users after
   *                         commit. Optional so unit tests can omit it.
   */
  constructor(
    private prisma: any,
    audit?: AuditService,
    private laptopAccounts: Pick<LaptopAccountService, 'reconcile'> | null = null,
  ) {
    this.audit = audit ?? new AuditService();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Return all pending merge suggestions, oldest first.
   * Retained for backwards compatibility with Sprint 001 callers.
   */
  async findPending(): Promise<MergeSuggestion[]> {
    return MergeSuggestionRepository.findPending(this.prisma);
  }

  /**
   * Return the suggestion for a specific user pair.
   * Callers must canonicalise pair order (lower id first).
   */
  async findByPair(userAId: number, userBId: number): Promise<MergeSuggestion | null> {
    return MergeSuggestionRepository.findByPair(this.prisma, userAId, userBId);
  }

  /**
   * Return all pending + deferred suggestions with lightweight user summaries,
   * ordered oldest first (FIFO review queue).
   */
  async findQueueItems(): Promise<MergeSuggestionQueueItem[]> {
    const rows = await (this.prisma as any).mergeSuggestion.findMany({
      where: { status: { in: ['pending', 'deferred'] } },
      orderBy: { created_at: 'asc' },
      include: {
        user_a: { select: { id: true, display_name: true, primary_email: true } },
        user_b: { select: { id: true, display_name: true, primary_email: true } },
      },
    });
    return rows;
  }

  /**
   * Return a single suggestion with full User records (including Logins and
   * ExternalAccounts) for the admin detail view.
   *
   * @throws NotFoundError if no suggestion with that id exists.
   */
  async findDetailById(id: number): Promise<MergeSuggestionDetail> {
    const now = new Date();
    const userInclude = {
      include: {
        logins: {
          select: { id: true, provider: true, provider_email: true, provider_payload: true },
        },
        external_accounts: { select: { id: true, type: true, status: true } },
        groups: { include: { group: { select: { name: true } } } },
        llm_proxy_tokens: {
          where: { revoked_at: null, expires_at: { gt: now } },
          select: { tokens_used: true, token_limit: true },
          orderBy: { granted_at: 'desc' },
          take: 1,
        },
      },
    };
    const row = await (this.prisma as any).mergeSuggestion.findUnique({
      where: { id },
      include: { user_a: userInclude, user_b: userInclude },
    });

    if (!row) {
      throw new NotFoundError(`MergeSuggestion ${id} not found`);
    }

    return {
      id: row.id,
      user_a: toMergeUserDetail(row.user_a),
      user_b: toMergeUserDetail(row.user_b),
      haiku_confidence: row.haiku_confidence,
      haiku_rationale: row.haiku_rationale,
      status: row.status,
      decided_by: row.decided_by,
      decided_at: row.decided_at,
      created_at: row.created_at,
    };
  }

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  /**
   * Execute the merge atomically inside a single Prisma interactive transaction.
   *
   * Steps (all inside one transaction):
   *  1. Load and validate the suggestion — must be pending or deferred.
   *  2. Validate survivorId belongs to the pair.
   *  3. Re-parent all Logins from non-survivor → survivor.
   *  4. ExternalAccounts: a non-survivor row whose (type) collides with a
   *     live (pending/active) survivor row is marked `removed` first (the
   *     partial unique index), then all rows are re-parented.
   *  5. UserGroup: memberships the survivor already has are dropped, the rest
   *     re-parented.
   *  6. LlmProxyToken: survivor without an active token takes the
   *     non-survivor's; otherwise the non-survivor's is revoked and its
   *     tokens_used / request_count added to the survivor's. Remaining rows
   *     are re-pointed for history.
   *  7. Credentials: `username` taken when the survivor has none (else
   *     dropped and recorded); `password_hash` + `laptop_password_hash` taken
   *     as a pair when the survivor has no password_hash.
   *  8. `allows_*` flags OR-ed; cohort inherited when the survivor has none.
   *  9. OAuth consents (duplicate client → dropped), access tokens, refresh
   *     tokens, authorization codes; provisioning requests (requester and
   *     decider); audit events (actor and target) re-pointed.
   * 10. Non-survivor: is_active=false, primary_email parked as
   *     `merged:<survivorId>:<email>`, username cleared when taken.
   * 11. Suggestion: status=approved, decided_by, decided_at.
   * 12. `merge_approve` AuditEvent whose details list everything above.
   *
   * After commit (only when this call owns the transaction, i.e. no `tx`):
   * `laptopAccounts.reconcile(survivor)` writes the survivor's roster entry
   * and, when the non-survivor had a username, `reconcile(nonSurvivor)` locks
   * its entry (`!`). Both never throw.
   *
   * @returns what was moved / dropped (also the audit payload).
   * @throws NotFoundError      if the suggestion does not exist.
   * @throws MergeConflictError if the suggestion is already approved/rejected,
   *                            or if survivorId is not part of the pair.
   */
  async approve(
    suggestionId: number,
    survivorUserId: number,
    actorId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<MergeOutcome> {
    const run = async (client: any): Promise<MergeOutcome> => {
      // 1. Load suggestion
      const suggestion = await MergeSuggestionRepository.findById(client, suggestionId);
      if (!suggestion) {
        throw new NotFoundError(`MergeSuggestion ${suggestionId} not found`);
      }

      // 2. Guard: must be actionable
      if (suggestion.status === 'approved' || suggestion.status === 'rejected') {
        throw new MergeConflictError(
          `MergeSuggestion ${suggestionId} is already ${suggestion.status}`,
        );
      }

      // 3. Validate survivor is part of the pair
      const { user_a_id, user_b_id } = suggestion;
      if (survivorUserId !== user_a_id && survivorUserId !== user_b_id) {
        throw new MergeConflictError(
          `survivorUserId ${survivorUserId} is not part of suggestion ${suggestionId}`,
        );
      }

      const nonSurvivorId = survivorUserId === user_a_id ? user_b_id : user_a_id;
      const outcome = await this.moveEverything(client, survivorUserId, nonSurvivorId);

      // 11. Mark suggestion approved
      await MergeSuggestionRepository.updateStatus(
        client,
        suggestionId,
        'approved',
        actorId,
        new Date(),
      );

      // 12. Audit
      await this.audit.record(client, {
        actor_user_id: actorId,
        action: 'merge_approve',
        target_user_id: survivorUserId,
        target_entity_type: 'MergeSuggestion',
        target_entity_id: String(suggestionId),
        details: { ...outcome },
      });

      return outcome;
    };

    if (tx) {
      return run(tx);
    }
    const outcome: MergeOutcome = await (this.prisma as any).$transaction(run);
    await this.reconcileRoster(outcome, actorId);
    return outcome;
  }

  /**
   * Admin-initiated merge of two arbitrary users: records a `MergeSuggestion`
   * (rationale `admin-initiated`, confidence 1.0; an existing undecided or
   * rejected row for the pair is reused) and approves it, so the audit trail
   * is the same as a queued merge.
   *
   * @throws NotFoundError  (404) when either user does not exist.
   * @throws AppError 400   when survivorId is neither user, or the users are the same.
   * @throws ConflictError  (409) when either user is inactive, or the pair was already merged.
   */
  async manualMerge(
    userId: number,
    otherUserId: number,
    survivorId: number,
    actorId: number,
  ): Promise<MergeOutcome> {
    if (userId === otherUserId) {
      throw new AppError('Cannot merge a user with itself', 400);
    }
    if (survivorId !== userId && survivorId !== otherUserId) {
      throw new AppError(`survivorId ${survivorId} is neither user`, 400);
    }

    const users: any[] = await (this.prisma as any).user.findMany({
      where: { id: { in: [userId, otherUserId] } },
    });
    for (const id of [userId, otherUserId]) {
      const u = users.find((row) => row.id === id);
      if (!u) throw new NotFoundError(`User ${id} not found`);
      if (!u.is_active) throw new ConflictError(`User ${id} is inactive`);
    }

    const userAId = Math.min(userId, otherUserId);
    const userBId = Math.max(userId, otherUserId);

    const suggestionId: number = await (this.prisma as any).$transaction(async (tx: any) => {
      const existing = await MergeSuggestionRepository.findByPair(tx, userAId, userBId);
      if (existing?.status === 'approved') {
        throw new ConflictError(`Users ${userAId} and ${userBId} were already merged`);
      }
      if (existing) {
        await tx.mergeSuggestion.update({
          where: { id: existing.id },
          data: {
            status: 'pending',
            haiku_confidence: 1.0,
            haiku_rationale: ADMIN_INITIATED_RATIONALE,
            decided_by: null,
            decided_at: null,
          },
        });
        return existing.id;
      }
      const created = await MergeSuggestionRepository.create(tx, {
        user_a_id: userAId,
        user_b_id: userBId,
        haiku_confidence: 1.0,
        haiku_rationale: ADMIN_INITIATED_RATIONALE,
        status: 'pending',
      });
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'merge_suggestion_created',
        target_user_id: userId,
        target_entity_type: 'MergeSuggestion',
        target_entity_id: String(created.id),
        details: {
          user_a_id: userAId,
          user_b_id: userBId,
          confidence: 1.0,
          rationale: ADMIN_INITIATED_RATIONALE,
        },
      });
      return created.id;
    });

    return this.approve(suggestionId, survivorId, actorId);
  }

  /**
   * Rule-based suggestion backfill (sprint 002 T008): runs the deterministic
   * rules for every active user with the given `created_via` against every
   * other active non-staff user. No LLM calls.
   */
  async rescan(createdVia: string = 'laptop_import'): Promise<RuleScanAllResult> {
    return ruleScanAll(this.prisma, this.audit, createdVia);
  }

  // ---------------------------------------------------------------------------
  // Merge internals
  // ---------------------------------------------------------------------------

  /** Steps 3-10 of `approve`; runs inside the caller's transaction. */
  private async moveEverything(
    client: any,
    survivorId: number,
    nonSurvivorId: number,
  ): Promise<MergeOutcome> {
    const now = new Date();
    const survivor = await client.user.findUniqueOrThrow({ where: { id: survivorId } });
    const nonSurvivor = await client.user.findUniqueOrThrow({ where: { id: nonSurvivorId } });

    // 3. Logins
    const logins = await client.login.updateMany({
      where: { user_id: nonSurvivorId },
      data: { user_id: survivorId },
    });

    // 4. ExternalAccounts — resolve partial-unique-index conflicts first.
    const survivorLive: any[] = await client.externalAccount.findMany({
      where: { user_id: survivorId, status: { in: EXTERNAL_ACCOUNT_LIVE_STATUSES } },
      select: { type: true },
    });
    const survivorLiveTypes = new Set(survivorLive.map((a) => a.type));
    const nonSurvivorLive: any[] = await client.externalAccount.findMany({
      where: { user_id: nonSurvivorId, status: { in: EXTERNAL_ACCOUNT_LIVE_STATUSES } },
      select: { id: true, type: true },
    });
    const externalAccountsRemoved: { id: number; type: string }[] = [];
    for (const account of nonSurvivorLive) {
      if (!survivorLiveTypes.has(account.type)) continue;
      await client.externalAccount.update({
        where: { id: account.id },
        data: { status: 'removed', status_changed_at: now },
      });
      externalAccountsRemoved.push({ id: account.id, type: account.type });
    }
    const externalAccounts = await client.externalAccount.updateMany({
      where: { user_id: nonSurvivorId },
      data: { user_id: survivorId },
    });

    // 5. UserGroup — skip memberships the survivor already has.
    const survivorGroups: any[] = await client.userGroup.findMany({
      where: { user_id: survivorId },
      select: { group_id: true },
    });
    const survivorGroupIds = new Set<number>(survivorGroups.map((g) => g.group_id));
    const nonSurvivorGroups: any[] = await client.userGroup.findMany({
      where: { user_id: nonSurvivorId },
      include: { group: { select: { name: true } } },
    });
    const groupsMoved: string[] = [];
    const groupsSkipped: string[] = [];
    for (const membership of nonSurvivorGroups) {
      if (survivorGroupIds.has(membership.group_id)) {
        await client.userGroup.delete({
          where: { user_id_group_id: { user_id: nonSurvivorId, group_id: membership.group_id } },
        });
        groupsSkipped.push(membership.group.name);
      } else {
        groupsMoved.push(membership.group.name);
      }
    }
    await client.userGroup.updateMany({
      where: { user_id: nonSurvivorId },
      data: { user_id: survivorId },
    });

    // 6. LlmProxyToken
    const activeWhere = { revoked_at: null, expires_at: { gt: now } };
    const survivorToken = await client.llmProxyToken.findFirst({
      where: { user_id: survivorId, ...activeWhere },
      orderBy: { granted_at: 'desc' },
    });
    const nonSurvivorToken = await client.llmProxyToken.findFirst({
      where: { user_id: nonSurvivorId, ...activeWhere },
      orderBy: { granted_at: 'desc' },
    });
    let tokenOutcome: MergeOutcome['llm_proxy_token'] = 'none';
    let usageCarried: MergeOutcome['llm_proxy_usage_carried'] = null;
    if (nonSurvivorToken) {
      if (!survivorToken) {
        await client.llmProxyToken.update({
          where: { id: nonSurvivorToken.id },
          data: { user_id: survivorId },
        });
        tokenOutcome = 'moved';
      } else {
        await client.llmProxyToken.update({
          where: { id: nonSurvivorToken.id },
          data: { revoked_at: now },
        });
        usageCarried = {
          tokens_used: nonSurvivorToken.tokens_used,
          request_count: nonSurvivorToken.request_count,
        };
        await client.llmProxyToken.update({
          where: { id: survivorToken.id },
          data: {
            tokens_used: { increment: nonSurvivorToken.tokens_used },
            request_count: { increment: nonSurvivorToken.request_count },
          },
        });
        tokenOutcome = 'revoked';
      }
    }
    const tokensRepointed = await client.llmProxyToken.updateMany({
      where: { user_id: nonSurvivorId },
      data: { user_id: survivorId },
    });

    // 7. Credentials
    const survivorData: Record<string, unknown> = {};
    let usernameOutcome: MergeOutcome['username'] = null;
    let usernameTaken = false;
    if (nonSurvivor.username) {
      if (!survivor.username) {
        usernameTaken = true;
        usernameOutcome = { taken: nonSurvivor.username };
        survivorData.username = nonSurvivor.username;
      } else {
        usernameOutcome = { dropped: nonSurvivor.username, kept: survivor.username };
      }
    }
    let passwordTaken = false;
    let laptopHashTaken = false;
    if (!survivor.password_hash && nonSurvivor.password_hash) {
      passwordTaken = true;
      survivorData.password_hash = nonSurvivor.password_hash;
      if (nonSurvivor.laptop_password_hash) {
        laptopHashTaken = true;
        survivorData.laptop_password_hash = nonSurvivor.laptop_password_hash;
      }
    }

    // 8. Flags OR-ed; cohort inheritance
    const flagsSet: string[] = [];
    for (const flag of ALLOWS_FLAGS) {
      if (!survivor[flag] && nonSurvivor[flag]) {
        survivorData[flag] = true;
        flagsSet.push(flag);
      }
    }
    let cohortInherited: number | null = null;
    if (survivor.cohort_id === null && nonSurvivor.cohort_id !== null) {
      survivorData.cohort_id = nonSurvivor.cohort_id;
      cohortInherited = nonSurvivor.cohort_id;
    }

    // 10a. Non-survivor first: free the unique username / email before the
    // survivor takes them.
    const parked = parkedEmail(survivorId, nonSurvivor.primary_email);
    await client.user.update({
      where: { id: nonSurvivorId },
      data: {
        is_active: false,
        primary_email: parked,
        ...(usernameTaken ? { username: null } : {}),
      },
    });
    if (Object.keys(survivorData).length > 0) {
      await client.user.update({ where: { id: survivorId }, data: survivorData });
    }

    // 9. OAuth rows
    const survivorConsents: any[] = await client.oAuthConsent.findMany({
      where: { user_id: survivorId },
      select: { oauth_client_id: true },
    });
    const consentedClientIds = survivorConsents.map((c) => c.oauth_client_id);
    const consentsDropped = consentedClientIds.length
      ? await client.oAuthConsent.deleteMany({
          where: { user_id: nonSurvivorId, oauth_client_id: { in: consentedClientIds } },
        })
      : { count: 0 };
    const consentsMoved = await client.oAuthConsent.updateMany({
      where: { user_id: nonSurvivorId },
      data: { user_id: survivorId },
    });
    const accessTokens = await client.oAuthAccessToken.updateMany({
      where: { user_id: nonSurvivorId },
      data: { user_id: survivorId },
    });
    const refreshTokens = await client.oAuthRefreshToken.updateMany({
      where: { user_id: nonSurvivorId },
      data: { user_id: survivorId },
    });
    const authCodes = await client.oAuthAuthorizationCode.updateMany({
      where: { user_id: nonSurvivorId },
      data: { user_id: survivorId },
    });

    // Provisioning requests (requester and decider)
    const provisioningRequests = await client.provisioningRequest.updateMany({
      where: { user_id: nonSurvivorId },
      data: { user_id: survivorId },
    });
    const provisioningDecisions = await client.provisioningRequest.updateMany({
      where: { decided_by: nonSurvivorId },
      data: { decided_by: survivorId },
    });

    // Audit events as actor / target
    const auditActor = await client.auditEvent.updateMany({
      where: { actor_user_id: nonSurvivorId },
      data: { actor_user_id: survivorId },
    });
    const auditTarget = await client.auditEvent.updateMany({
      where: { target_user_id: nonSurvivorId },
      data: { target_user_id: survivorId },
    });

    return {
      survivor_id: survivorId,
      non_survivor_id: nonSurvivorId,
      merged_into: survivorId,
      parked_email: parked,
      logins_moved: logins.count,
      external_accounts_moved: externalAccounts.count,
      external_accounts_removed: externalAccountsRemoved,
      groups_moved: groupsMoved,
      groups_skipped: groupsSkipped,
      llm_proxy_token: tokenOutcome,
      llm_proxy_usage_carried: usageCarried,
      llm_proxy_tokens_repointed: tokensRepointed.count,
      username: usernameOutcome,
      password_hash_taken: passwordTaken,
      laptop_password_hash_taken: laptopHashTaken,
      flags_set: flagsSet,
      cohort_inherited: cohortInherited,
      oauth_consents_moved: consentsMoved.count,
      oauth_consents_dropped: consentsDropped.count,
      oauth_access_tokens_moved: accessTokens.count,
      oauth_refresh_tokens_moved: refreshTokens.count,
      oauth_authorization_codes_moved: authCodes.count,
      provisioning_requests_moved: provisioningRequests.count,
      provisioning_decisions_moved: provisioningDecisions.count,
      audit_events_repointed: { actor: auditActor.count, target: auditTarget.count },
    };
  }

  /**
   * Post-commit laptop roster write-back. The survivor's entry is (re)written;
   * when the non-survivor had a username its entry is locked (`reconcile` on
   * an inactive user writes `!`; when the username moved there is nothing
   * left under the non-survivor and the call is a no-op). Never throws.
   */
  private async reconcileRoster(outcome: MergeOutcome, actorId: number): Promise<void> {
    if (!this.laptopAccounts) return;
    try {
      await this.laptopAccounts.reconcile(outcome.survivor_id, actorId);
      if (outcome.username !== null) {
        await this.laptopAccounts.reconcile(outcome.non_survivor_id, actorId);
      }
    } catch (err) {
      logger.error({ err, outcome }, '[merge] Laptop roster reconcile after merge failed.');
    }
  }

  /**
   * Mark the suggestion as rejected and write an audit event.
   *
   * @throws NotFoundError      if the suggestion does not exist.
   * @throws MergeConflictError if the suggestion is already approved or rejected.
   */
  async reject(
    suggestionId: number,
    actorId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (client: any) => {
      const suggestion = await MergeSuggestionRepository.findById(client, suggestionId);
      if (!suggestion) {
        throw new NotFoundError(`MergeSuggestion ${suggestionId} not found`);
      }

      if (suggestion.status === 'approved' || suggestion.status === 'rejected') {
        throw new MergeConflictError(
          `MergeSuggestion ${suggestionId} is already ${suggestion.status}`,
        );
      }

      await MergeSuggestionRepository.updateStatus(
        client,
        suggestionId,
        'rejected',
        actorId,
        new Date(),
      );

      await this.audit.record(client, {
        actor_user_id: actorId,
        action: 'merge_reject',
        target_entity_type: 'MergeSuggestion',
        target_entity_id: String(suggestionId),
        details: {
          user_a_id: suggestion.user_a_id,
          user_b_id: suggestion.user_b_id,
        },
      });
    };

    if (tx) {
      await run(tx);
    } else {
      await (this.prisma as any).$transaction(run);
    }
  }

  /**
   * Defer the suggestion — hide it from the default queue but retain the row
   * for later review.  Does NOT set decided_by or decided_at.
   *
   * @throws NotFoundError      if the suggestion does not exist.
   * @throws MergeConflictError if the suggestion is already approved or rejected.
   */
  async defer(
    suggestionId: number,
    tx?: Prisma.TransactionClient,
  ): Promise<void> {
    const run = async (client: any) => {
      const suggestion = await MergeSuggestionRepository.findById(client, suggestionId);
      if (!suggestion) {
        throw new NotFoundError(`MergeSuggestion ${suggestionId} not found`);
      }

      if (suggestion.status === 'approved' || suggestion.status === 'rejected') {
        throw new MergeConflictError(
          `MergeSuggestion ${suggestionId} is already ${suggestion.status}`,
        );
      }

      // Use direct update — decided_by and decided_at must remain null.
      await (client as any).mergeSuggestion.update({
        where: { id: suggestionId },
        data: { status: 'deferred' },
      });
    };

    if (tx) {
      await run(tx);
    } else {
      await (this.prisma as any).$transaction(run);
    }
  }
}

// ---------------------------------------------------------------------------
// Detail projection helper
// ---------------------------------------------------------------------------

/** Project a User row (with the includes from `findDetailById`) to `MergeUserDetail`. */
function toMergeUserDetail(user: any): MergeUserDetail {
  const usernameLogin = (user.logins ?? []).find((l: any) => l.provider === 'username');
  const payload = usernameLogin?.provider_payload;
  const createdHost =
    payload && typeof payload === 'object' && typeof payload.created_host === 'string'
      ? payload.created_host
      : null;
  const token = user.llm_proxy_tokens?.[0];
  return {
    id: user.id,
    display_name: user.display_name,
    primary_email: user.primary_email,
    cohort_id: user.cohort_id,
    is_active: user.is_active,
    username: user.username ?? null,
    created_via: user.created_via,
    created_host: createdHost,
    llm_proxy_token: token
      ? { tokens_used: token.tokens_used, token_limit: token.token_limit }
      : null,
    groups: (user.groups ?? []).map((m: any) => m.group.name),
    logins: (user.logins ?? []).map((l: any) => ({
      id: l.id,
      provider: l.provider,
      provider_email: l.provider_email,
    })),
    external_accounts: (user.external_accounts ?? []).map((a: any) => ({
      id: a.id,
      type: a.type,
      status: a.status,
    })),
  };
}
