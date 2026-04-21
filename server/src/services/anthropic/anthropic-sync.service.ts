/**
 * AnthropicSyncService — reconciles Anthropic org state against local
 * ExternalAccount rows (Sprint 010 T011).
 *
 * reconcile() performs three passes:
 *
 *  1. Link by email — For each Anthropic org user whose email matches a local
 *     User (case-insensitive) and who has no type=claude ExternalAccount:
 *     creates ExternalAccount(type='claude', status='active', external_id=<user id>).
 *
 *  2. Invite-accepted transition — For each pending invite in the API, finds
 *     the local ExternalAccount with external_id=<invite id>. If the invite
 *     email now appears in the org users list: transitions to active, rewrites
 *     external_id to the Anthropic user id, and calls
 *     addUserToWorkspace(studentsWorkspaceId, userId).
 *
 *  3. Stale removal — For each local type=claude ExternalAccount whose
 *     external_id is absent from both the org users list and the invites
 *     list: transitions to removed, emits a claude_sync_flagged AuditEvent.
 *
 * Returns SyncReport { created, linked, invitedAccepted, removed, unmatched }.
 *
 * Students workspace ID is resolved once per process:
 *  - CLAUDE_STUDENT_WORKSPACE env var (overrides lookup, default "Students")
 *  - Falls back to listWorkspaces() and finds by name
 *
 * Constructor takes AnthropicAdminClient, PrismaClient, AuditService.
 */

import { createLogger } from '../logger.js';
import type { AnthropicAdminClient, AnthropicUser, AnthropicInvite } from './anthropic-admin.client.js';
import type { AuditService } from '../audit.service.js';
import { UserRepository } from '../repositories/user.repository.js';
import { ExternalAccountRepository } from '../repositories/external-account.repository.js';

const logger = createLogger('anthropic-sync');

// ---------------------------------------------------------------------------
// Report type
// ---------------------------------------------------------------------------

export interface SyncReport {
  /** Number of new ExternalAccount rows created by linking org users to local Users. */
  created: number;
  /** Alias for created (same value). Kept for API symmetry. */
  linked: number;
  /** Number of pending-invite ExternalAccounts transitioned to active. */
  invitedAccepted: number;
  /** Number of stale ExternalAccounts transitioned to removed. */
  removed: number;
  /** Emails of Anthropic org users that could not be matched to a local User. */
  unmatched: string[];
}

// ---------------------------------------------------------------------------
// AnthropicSyncService
// ---------------------------------------------------------------------------

export class AnthropicSyncService {
  /** Cached Students workspace ID (resolved once per process). */
  private studentsWorkspaceIdCache: string | undefined;

  constructor(
    private readonly anthropicClient: AnthropicAdminClient,
    private readonly prisma: any,
    private readonly auditService: AuditService,
  ) {}

  // ---------------------------------------------------------------------------
  // resolveStudentsWorkspace
  // ---------------------------------------------------------------------------

  /**
   * Resolve the Students workspace ID, caching the result for the lifetime of
   * this process.
   *
   * Resolution order:
   *  1. In-process cache (set on first successful lookup).
   *  2. CLAUDE_STUDENT_WORKSPACE env var, if set to a workspace ID (not a name).
   *     By convention the env var holds the workspace NAME, so we fall through to
   *     lookup even when it is set.
   *  3. listWorkspaces() — find the workspace whose name matches
   *     CLAUDE_STUDENT_WORKSPACE (default "Students").
   *
   * Throws if no workspace with the target name is found.
   */
  async resolveStudentsWorkspace(): Promise<string> {
    if (this.studentsWorkspaceIdCache !== undefined) {
      return this.studentsWorkspaceIdCache;
    }

    const targetName = process.env.CLAUDE_STUDENT_WORKSPACE ?? 'Students';
    logger.info({ targetName }, '[anthropic-sync] resolveStudentsWorkspace: looking up workspace by name');

    const workspaces = await this.anthropicClient.listWorkspaces();
    const workspace = workspaces.find((ws) => ws.name === targetName);

    if (!workspace) {
      const names = workspaces.map((ws) => ws.name).join(', ');
      throw new Error(
        `AnthropicSyncService: could not find workspace named "${targetName}". ` +
          `Available workspaces: [${names}]`,
      );
    }

    logger.info(
      { workspaceId: workspace.id, workspaceName: workspace.name },
      '[anthropic-sync] resolveStudentsWorkspace: workspace found and cached',
    );

    this.studentsWorkspaceIdCache = workspace.id;
    return workspace.id;
  }

  // ---------------------------------------------------------------------------
  // fetchAllOrgUsers
  // ---------------------------------------------------------------------------

  /** Fetch all org users, following pagination until nextCursor is null. */
  private async fetchAllOrgUsers(): Promise<AnthropicUser[]> {
    const all: AnthropicUser[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.anthropicClient.listOrgUsers(cursor);
      all.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    logger.info({ count: all.length }, '[anthropic-sync] fetchAllOrgUsers: done');
    return all;
  }

  // ---------------------------------------------------------------------------
  // fetchAllInvites
  // ---------------------------------------------------------------------------

  /** Fetch all pending invites, following pagination until nextCursor is null. */
  private async fetchAllInvites(): Promise<AnthropicInvite[]> {
    const all: AnthropicInvite[] = [];
    let cursor: string | undefined;

    do {
      const page = await this.anthropicClient.listInvites(cursor);
      all.push(...page.data);
      cursor = page.nextCursor;
    } while (cursor !== undefined);

    logger.info({ count: all.length }, '[anthropic-sync] fetchAllInvites: done');
    return all;
  }

  // ---------------------------------------------------------------------------
  // reconcile
  // ---------------------------------------------------------------------------

  /**
   * Reconcile Anthropic org state against local ExternalAccount rows.
   *
   * @param actorId - The system/admin user ID recorded as actor on created
   *                  audit events (null for system-initiated syncs is allowed
   *                  by AuditService but a real user ID is preferred).
   */
  async reconcile(actorId: number | null = null): Promise<SyncReport> {
    logger.info({ actorId }, '[anthropic-sync] reconcile: starting');

    const report: SyncReport = {
      created: 0,
      linked: 0,
      invitedAccepted: 0,
      removed: 0,
      unmatched: [],
    };

    // --- 1. Fetch all org users and invites ---
    const [orgUsers, invites, studentsWsId] = await Promise.all([
      this.fetchAllOrgUsers(),
      this.fetchAllInvites(),
      this.resolveStudentsWorkspace(),
    ]);

    // Build lookup maps
    const orgUserByEmail = new Map<string, AnthropicUser>(
      orgUsers.map((u) => [u.email.toLowerCase(), u]),
    );
    const orgUserById = new Map<string, AnthropicUser>(
      orgUsers.map((u) => [u.id, u]),
    );
    const inviteById = new Map<string, AnthropicInvite>(
      invites.map((inv) => [inv.id, inv]),
    );

    // Build set of all external IDs observed in the Anthropic API
    const observedExternalIds = new Set<string>([
      ...orgUsers.map((u) => u.id),
      ...invites.map((inv) => inv.id),
    ]);

    // --- 2. Pass 1: Link org users to local Users ---
    for (const orgUser of orgUsers) {
      await this.prisma.$transaction(async (tx: any) => {
        // Check if there is already a claude ExternalAccount linked to this org user id
        const existingById = await tx.externalAccount.findFirst({
          where: { type: 'claude', external_id: orgUser.id },
        });
        if (existingById) {
          // Already linked — nothing to do
          return;
        }

        // Try to match by email. Emails are stored lowercase in our DB (normalised
        // by OAuth providers). We lowercase the Anthropic-sourced email before lookup
        // to handle any mixed-case values returned by the API.
        const emailLower = orgUser.email.toLowerCase();
        const localUser = await tx.user.findFirst({
          where: { primary_email: emailLower },
        });

        if (!localUser) {
          logger.info(
            { orgUserId: orgUser.id, email: orgUser.email },
            '[anthropic-sync] reconcile: no local user found for org user — adding to unmatched',
          );
          report.unmatched.push(orgUser.email);
          return;
        }

        // Check if the local user already has a pending/active claude ExternalAccount
        const existingClaude = await tx.externalAccount.findFirst({
          where: {
            user_id: localUser.id,
            type: 'claude',
            status: { in: ['pending', 'active'] },
          },
        });

        if (existingClaude) {
          // Already has a live claude account — skip
          logger.info(
            { userId: localUser.id, existingAccountId: existingClaude.id },
            '[anthropic-sync] reconcile: local user already has a claude account — skipping',
          );
          return;
        }

        // Create the ExternalAccount link
        await tx.externalAccount.create({
          data: {
            user_id: localUser.id,
            type: 'claude',
            status: 'active',
            external_id: orgUser.id,
            status_changed_at: new Date(),
          },
        });

        await this.auditService.record(tx, {
          actor_user_id: actorId,
          action: 'claude_sync_linked',
          target_user_id: localUser.id,
          target_entity_type: 'ExternalAccount',
          details: { anthropicUserId: orgUser.id, email: orgUser.email },
        });

        report.created++;
        report.linked = report.created;
        logger.info(
          { userId: localUser.id, orgUserId: orgUser.id, email: orgUser.email },
          '[anthropic-sync] reconcile: created ExternalAccount link',
        );
      });
    }

    // --- 3. Pass 2: Invite-accepted transitions ---
    // Find all local ExternalAccounts with status=pending and type=claude
    const pendingClaudeAccounts = await this.prisma.externalAccount.findMany({
      where: { type: 'claude', status: 'pending' },
    });

    for (const localAccount of pendingClaudeAccounts) {
      const externalId = localAccount.external_id;
      if (!externalId) continue;

      // If this external_id matches an invite, check if the invite's email is now in org users
      const invite = inviteById.get(externalId);
      if (!invite) {
        // external_id not in invites — will be handled by stale-removal pass
        continue;
      }

      // Check if the invite email now appears as an org user
      const orgUserForInvite = orgUserByEmail.get(invite.email.toLowerCase());
      if (orgUserForInvite) {
        // Invite accepted — transition to active
        await this.prisma.$transaction(async (tx: any) => {
          await tx.externalAccount.update({
            where: { id: localAccount.id },
            data: {
              status: 'active',
              external_id: orgUserForInvite.id,
              status_changed_at: new Date(),
            },
          });

          await this.anthropicClient.addUserToWorkspace(studentsWsId, orgUserForInvite.id);

          await this.auditService.record(tx, {
            actor_user_id: actorId,
            action: 'claude_sync_invite_accepted',
            target_user_id: localAccount.user_id,
            target_entity_type: 'ExternalAccount',
            target_entity_id: String(localAccount.id),
            details: {
              inviteId: externalId,
              anthropicUserId: orgUserForInvite.id,
              email: invite.email,
            },
          });

          report.invitedAccepted++;
          logger.info(
            { accountId: localAccount.id, inviteId: externalId, newUserId: orgUserForInvite.id },
            '[anthropic-sync] reconcile: invite accepted — transitioned to active',
          );
        });

        // Update the observed set so this new user id is not flagged as stale
        observedExternalIds.add(orgUserForInvite.id);
      }
    }

    // --- 4. Pass 3: Stale removal ---
    // Find all local claude ExternalAccounts with status NOT removed
    const allClaudeAccounts = await this.prisma.externalAccount.findMany({
      where: { type: 'claude', status: { not: 'removed' } },
    });

    for (const localAccount of allClaudeAccounts) {
      const externalId = localAccount.external_id;
      if (!externalId) continue;

      if (!observedExternalIds.has(externalId)) {
        await this.prisma.$transaction(async (tx: any) => {
          await tx.externalAccount.update({
            where: { id: localAccount.id },
            data: { status: 'removed', status_changed_at: new Date() },
          });

          await this.auditService.record(tx, {
            actor_user_id: actorId,
            action: 'claude_sync_flagged',
            target_user_id: localAccount.user_id,
            target_entity_type: 'ExternalAccount',
            target_entity_id: String(localAccount.id),
            details: { externalId, previousStatus: localAccount.status },
          });

          report.removed++;
          logger.info(
            { accountId: localAccount.id, externalId },
            '[anthropic-sync] reconcile: stale ExternalAccount flagged as removed',
          );
        });
      }
    }

    logger.info(report, '[anthropic-sync] reconcile: complete');
    return report;
  }
}
