/**
 * BulkLlmProxyService — bulk grant / revoke of LLM proxy access across
 * an app-level group.
 *
 * Scoping predicate: membership in `UserGroup` AND `User.is_active = true`.
 *
 * Per-user mutation runs inside its own `prisma.$transaction` via
 * `LlmProxyTokenService.grant` / `revoke`. A failure on one user does
 * not abort the batch — callers receive `{succeeded, failed, skipped}`
 * and the UI renders the breakdown.
 *
 * Skipped semantics:
 *  - bulkGrant: user already has an active token (avoid duplicate
 *    ConflictErrors), OR user has no group granting allowsLlmProxy
 *    (Sprint 026 T004 permission gate — skipped with reason 'no_permission').
 *  - bulkRevoke: user has no active token to revoke.
 *
 * Return shape:
 *  - bulkGrant additionally returns `tokensByUser` — a map of userId →
 *    plaintext token so the admin UI can surface the tokens to hand to
 *    students. The plaintext-once invariant holds: tokens are returned
 *    in this one response and never re-fetched.
 *  - `skippedReasons` — a map of userId → reason string ('no_permission' or
 *    'already_has_token') for users that were skipped in bulkGrant.
 */

import { NotFoundError } from '../errors.js';
import { createLogger } from './logger.js';
import { GroupRepository } from './repositories/group.repository.js';
import type { LlmProxyTokenService } from './llm-proxy-token.service.js';
import type { GroupService } from './group.service.js';

const logger = createLogger('bulk-llm-proxy-service');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BulkLlmProxyScope = { kind: 'group'; id: number };

export type BulkLlmProxyGrantParams = {
  expiresAt: Date;
  tokenLimit: number;
};

export type BulkLlmProxyFailure = {
  userId: number;
  userName: string;
  error: string;
};

export type BulkLlmProxyResult = {
  succeeded: number[];
  failed: BulkLlmProxyFailure[];
  skipped: number[];
  /**
   * Per-user reason for being skipped in a bulkGrant. Values:
   *  - 'no_permission' — user has no group with allowsLlmProxy=true.
   *  - 'already_has_token' — duplicate grant suppressed (user already has an active token).
   *
   * Sprint 026 T004.
   */
  skippedReasons?: Record<number, string>;
  /** Populated only by bulkGrant (plaintext tokens keyed by userId). */
  tokensByUser?: Record<number, string>;
};

// Small projection of User used inside the service — only the fields we need.
type MemberRow = {
  id: number;
  display_name: string | null;
  primary_email: string;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class BulkLlmProxyService {
  constructor(
    private readonly prisma: any,
    private readonly llmProxyTokens: LlmProxyTokenService,
    /** Optional GroupService used to gate bulk grants by allowsLlmProxy. Sprint 026 T004. */
    private readonly groups?: GroupService,
  ) {}

  // --------------------------------------------------------------------
  // Scope resolution
  // --------------------------------------------------------------------

  private async resolveMembers(
    scope: BulkLlmProxyScope,
    userIds?: number[],
  ): Promise<MemberRow[]> {
    const userIdFilter = userIds && userIds.length > 0 ? { in: userIds } : undefined;
    const group = await GroupRepository.findById(this.prisma, scope.id);
    if (!group) throw new NotFoundError(`Group ${scope.id} not found`);
    const users = await (this.prisma as any).user.findMany({
      where: {
        ...(userIdFilter && { id: userIdFilter }),
        is_active: true,
        groups: { some: { group_id: scope.id } },
      },
      select: { id: true, display_name: true, primary_email: true },
      orderBy: { display_name: 'asc' },
    });
    return users;
  }

  // --------------------------------------------------------------------
  // bulkGrant
  // --------------------------------------------------------------------

  async bulkGrant(
    scope: BulkLlmProxyScope,
    params: BulkLlmProxyGrantParams,
    actorId: number,
    userIds?: number[],
  ): Promise<BulkLlmProxyResult> {
    const members = await this.resolveMembers(scope, userIds);
    const succeeded: number[] = [];
    const failed: BulkLlmProxyFailure[] = [];
    const skipped: number[] = [];
    const skippedReasons: Record<number, string> = {};
    const tokensByUser: Record<number, string> = {};

    for (const m of members) {
      // Permission gate — skip users whose groups do not grant LLM proxy access.
      // Sprint 026 T004: only gate when GroupService is wired in.
      if (this.groups) {
        const perms = await this.groups.userPermissions(m.id);
        if (!perms.llmProxy) {
          skipped.push(m.id);
          skippedReasons[m.id] = 'no_permission';
          logger.debug(
            { userId: m.id, scope },
            '[bulk-llm-proxy] skipping user — no allowsLlmProxy group',
          );
          continue;
        }
      }

      const already = await this.llmProxyTokens.getActiveForUser(m.id);
      if (already) {
        skipped.push(m.id);
        skippedReasons[m.id] = 'already_has_token';
        continue;
      }
      try {
        const { token } = await this.llmProxyTokens.grant(
          m.id,
          params,
          actorId,
          { scope: scope.kind, scopeId: scope.id },
        );
        succeeded.push(m.id);
        tokensByUser[m.id] = token;
      } catch (err: any) {
        logger.warn(
          { err, userId: m.id, scope },
          '[bulk-llm-proxy] grant failed for user',
        );
        failed.push({
          userId: m.id,
          userName: m.display_name ?? m.primary_email,
          error: err?.message ?? String(err),
        });
      }
    }

    return { succeeded, failed, skipped, skippedReasons, tokensByUser };
  }

  // --------------------------------------------------------------------
  // bulkRevoke
  // --------------------------------------------------------------------

  async bulkRevoke(
    scope: BulkLlmProxyScope,
    actorId: number,
    userIds?: number[],
  ): Promise<BulkLlmProxyResult> {
    const members = await this.resolveMembers(scope, userIds);
    const succeeded: number[] = [];
    const failed: BulkLlmProxyFailure[] = [];
    const skipped: number[] = [];

    for (const m of members) {
      const active = await this.llmProxyTokens.getActiveForUser(m.id);
      if (!active) {
        skipped.push(m.id);
        continue;
      }
      try {
        await this.llmProxyTokens.revoke(m.id, actorId);
        succeeded.push(m.id);
      } catch (err: any) {
        logger.warn(
          { err, userId: m.id, scope },
          '[bulk-llm-proxy] revoke failed for user',
        );
        failed.push({
          userId: m.id,
          userName: m.display_name ?? m.primary_email,
          error: err?.message ?? String(err),
        });
      }
    }

    return { succeeded, failed, skipped };
  }
}
