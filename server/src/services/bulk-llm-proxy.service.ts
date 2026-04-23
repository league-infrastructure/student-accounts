/**
 * BulkLlmProxyService — bulk grant / revoke of LLM proxy access across
 * a cohort or an app-level group (Sprint 013 T007).
 *
 * Scoping predicate:
 *  - cohort: `User.cohort_id = scope.id` AND `is_active = true`.
 *  - group:  membership in `UserGroup` AND `is_active = true`.
 *
 * Per-user mutation runs inside its own `prisma.$transaction` via
 * `LlmProxyTokenService.grant` / `revoke`. A failure on one user does
 * not abort the batch — callers receive `{succeeded, failed, skipped}`
 * and the UI renders the breakdown.
 *
 * Skipped semantics:
 *  - bulkGrant: user already has an active token (avoid duplicate
 *    ConflictErrors).
 *  - bulkRevoke: user has no active token to revoke.
 *
 * Return shape:
 *  - bulkGrant additionally returns `tokensByUser` — a map of userId →
 *    plaintext token so the admin UI can surface the tokens to hand to
 *    students. The plaintext-once invariant holds: tokens are returned
 *    in this one response and never re-fetched.
 */

import { NotFoundError } from '../errors.js';
import { createLogger } from './logger.js';
import { CohortRepository } from './repositories/cohort.repository.js';
import { GroupRepository } from './repositories/group.repository.js';
import type { LlmProxyTokenService } from './llm-proxy-token.service.js';

const logger = createLogger('bulk-llm-proxy-service');

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type BulkLlmProxyScope =
  | { kind: 'cohort'; id: number }
  | { kind: 'group'; id: number };

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
  ) {}

  // --------------------------------------------------------------------
  // Scope resolution
  // --------------------------------------------------------------------

  private async resolveMembers(
    scope: BulkLlmProxyScope,
    userIds?: number[],
  ): Promise<MemberRow[]> {
    const userIdFilter = userIds && userIds.length > 0 ? { in: userIds } : undefined;

    if (scope.kind === 'cohort') {
      const cohort = await CohortRepository.findById(this.prisma, scope.id);
      if (!cohort) throw new NotFoundError(`Cohort ${scope.id} not found`);
      const users = await (this.prisma as any).user.findMany({
        where: {
          ...(userIdFilter && { id: userIdFilter }),
          cohort_id: scope.id,
          is_active: true,
        },
        select: { id: true, display_name: true, primary_email: true },
        orderBy: { display_name: 'asc' },
      });
      return users;
    }
    // group
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
    const tokensByUser: Record<number, string> = {};

    for (const m of members) {
      const already = await this.llmProxyTokens.getActiveForUser(m.id);
      if (already) {
        skipped.push(m.id);
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

    return { succeeded, failed, skipped, tokensByUser };
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
