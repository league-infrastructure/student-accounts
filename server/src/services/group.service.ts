/**
 * GroupService — domain logic for the Group entity (Sprint 012 T002).
 *
 * Responsibilities:
 *  - Group CRUD with uniqueness and non-blank-name validation.
 *  - Membership add/remove.
 *  - User search scoped to "not already in this group".
 *  - Group listing for a specific user.
 *  - Audit-event recording for every state-changing operation in the same
 *    transaction as the mutation (AuditService invariant).
 *  - User permission reads via userPermissions (flags live on User row).
 *
 * Errors thrown:
 *  - ValidationError (422) — blank name.
 *  - ConflictError (409)   — duplicate group name or duplicate membership.
 *  - NotFoundError (404)   — missing group, user, or membership.
 */

import { createLogger } from './logger.js';
import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import { GroupRepository } from './repositories/group.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import type {
  GroupWithMemberCount,
  MemberRow,
  UserSearchResult,
} from './repositories/group.repository.js';
import type { Group } from '../generated/prisma/client.js';
import type { WorkspaceProvisioningService } from './workspace-provisioning.service.js';

const logger = createLogger('group-service');

// Minimum query length for searchUsersNotInGroup — avoids thrashing the
// autocomplete endpoint on single-character input.
const MIN_SEARCH_LEN = 2;

// ---------------------------------------------------------------------------
// provisionUserIfNeeded — Sprint 027 T004
// ---------------------------------------------------------------------------

/**
 * Provision a Workspace account for a single user if they do not already have
 * an active or pending workspace ExternalAccount.
 *
 * Fail-soft: provisioning errors are logged but not propagated. The caller
 * receives a resolved Promise regardless of whether provisioning succeeded.
 *
 * @param prisma                - Prisma client (or any DbClient).
 * @param workspaceProvisioning - WorkspaceProvisioningService instance.
 * @param userId                - Target user primary key.
 * @param actorId               - Admin performing the action (for audit log).
 */
export async function provisionUserIfNeeded(
  prisma: any,
  workspaceProvisioning: WorkspaceProvisioningService,
  userId: number,
  actorId: number,
): Promise<void> {
  // Skip if user already has an active/pending workspace account.
  const existing = await ExternalAccountRepository.findActiveByUserAndType(
    prisma,
    userId,
    'workspace',
  );
  if (existing) {
    logger.info(
      { userId },
      '[provision-user-if-needed] workspace account already exists — skipping',
    );
    return;
  }

  try {
    await prisma.$transaction(async (tx: any) => {
      await workspaceProvisioning.provision(userId, actorId, tx);
    });
    logger.info(
      { userId, actorId },
      '[provision-user-if-needed] workspace account provisioned',
    );
  } catch (err: any) {
    logger.warn(
      { userId, actorId, error: err?.message },
      '[provision-user-if-needed] provisioning failed (fail-soft, continuing)',
    );
  }
}

export type GroupSummary = {
  id: number;
  name: string;
  description: string | null;
  memberCount: number;
  createdAt: Date;
};

export type GroupDetail = {
  group: { id: number; name: string; description: string | null; createdAt: Date };
  users: Array<{
    id: number;
    displayName: string | null;
    email: string;
    role: string;
    externalAccounts: Array<{ type: string; status: string; externalId: string | null }>;
    llmProxyToken?: { status: 'active' | 'pending' | 'none' };
    allowsOauthClient: boolean;
    allowsLlmProxy: boolean;
    allowsLeagueAccount: boolean;
  }>;
};

export class GroupService {
  constructor(
    private readonly prisma: any,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------

  async create(
    data: { name: string; description?: string | null },
    actorId: number,
  ): Promise<Group> {
    const trimmedName = (data.name ?? '').trim();
    if (!trimmedName) {
      throw new ValidationError('Group name must not be blank.');
    }

    const existing = await GroupRepository.findByName(this.prisma, trimmedName);
    if (existing) {
      throw new ConflictError(`A group named "${trimmedName}" already exists.`);
    }

    return this.prisma.$transaction(async (tx: any) => {
      const group = await GroupRepository.create(tx, {
        name: trimmedName,
        description: data.description ?? null,
      });
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'create_group',
        target_entity_type: 'Group',
        target_entity_id: String(group.id),
        details: { name: trimmedName, description: group.description },
      });
      return group;
    });
  }

  // --------------------------------------------------------------------
  // Update
  // --------------------------------------------------------------------

  async update(
    id: number,
    data: { name?: string; description?: string | null },
    actorId: number,
  ): Promise<Group> {
    const existing = await GroupRepository.findById(this.prisma, id);
    if (!existing) throw new NotFoundError(`Group ${id} not found`);

    const updates: { name?: string; description?: string | null } = {};

    if (data.name !== undefined) {
      const trimmed = data.name.trim();
      if (!trimmed) throw new ValidationError('Group name must not be blank.');
      if (trimmed !== existing.name) {
        const dup = await GroupRepository.findByName(this.prisma, trimmed);
        if (dup && dup.id !== id) {
          throw new ConflictError(`A group named "${trimmed}" already exists.`);
        }
        updates.name = trimmed;
      }
    }
    if (data.description !== undefined) {
      updates.description = data.description;
    }

    if (Object.keys(updates).length === 0) {
      return existing;
    }

    return this.prisma.$transaction(async (tx: any) => {
      const updated = await GroupRepository.update(tx, id, updates);
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'update_group',
        target_entity_type: 'Group',
        target_entity_id: String(id),
        details: {
          old: { name: existing.name, description: existing.description },
          new: { name: updated.name, description: updated.description },
        },
      });
      return updated;
    });
  }

  // --------------------------------------------------------------------
  // Delete
  // --------------------------------------------------------------------

  async delete(id: number, actorId: number): Promise<void> {
    const existing = await GroupRepository.findById(this.prisma, id);
    if (!existing) throw new NotFoundError(`Group ${id} not found`);

    await this.prisma.$transaction(async (tx: any) => {
      const memberCount = await GroupRepository.countMembers(tx, id);
      await GroupRepository.deleteMembershipsForGroup(tx, id);
      await GroupRepository.delete(tx, id);
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'delete_group',
        target_entity_type: 'Group',
        target_entity_id: String(id),
        details: { name: existing.name, memberCount },
      });
    });

    logger.info({ id, actorId, name: existing.name }, '[group-service] deleted group');
  }

  // --------------------------------------------------------------------
  // Read
  // --------------------------------------------------------------------

  async findById(id: number): Promise<Group> {
    const group = await GroupRepository.findById(this.prisma, id);
    if (!group) throw new NotFoundError(`Group ${id} not found`);
    return group;
  }

  async findAll(): Promise<GroupSummary[]> {
    const rows = await GroupRepository.findAllWithMemberCount(this.prisma);
    return rows.map((r: GroupWithMemberCount) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      memberCount: r.memberCount,
      createdAt: r.created_at,
    }));
  }

  async listMembers(groupId: number): Promise<GroupDetail> {
    const group = await this.findById(groupId);
    const members = await GroupRepository.listMembers(this.prisma, groupId);

    // Helper function to compute LLM proxy status
    const computeProxyStatus = (tokens: any[]): 'active' | 'pending' | 'none' => {
      if (!tokens || tokens.length === 0) return 'none';
      const token = tokens[0]; // Most recent token
      if (token.revoked_at) return 'none';
      const now = new Date();
      if (token.expires_at && now > token.expires_at) return 'pending'; // Expired
      return 'active';
    };

    return {
      group: {
        id: group.id,
        name: group.name,
        description: group.description,
        createdAt: group.created_at,
      },
      users: members.map((u: MemberRow) => ({
        id: u.id,
        displayName: u.display_name,
        email: u.primary_email,
        role: u.role,
        externalAccounts: (u.external_accounts ?? []).map((a) => ({
          type: a.type,
          status: a.status,
          externalId: a.external_id,
        })),
        llmProxyToken: {
          status: computeProxyStatus((u as any).llm_proxy_tokens ?? []),
        },
        allowsOauthClient: u.allows_oauth_client ?? false,
        allowsLlmProxy: u.allows_llm_proxy ?? false,
        allowsLeagueAccount: u.allows_league_account ?? false,
      })),
    };
  }

  // --------------------------------------------------------------------
  // Membership
  // --------------------------------------------------------------------

  async addMember(
    groupId: number,
    userId: number,
    actorId: number,
  ): Promise<void> {
    const group = await GroupRepository.findById(this.prisma, groupId);
    if (!group) throw new NotFoundError(`Group ${groupId} not found`);

    const user = await UserRepository.findByIdIncludingInactive(
      this.prisma,
      userId,
    );
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    const already = await GroupRepository.isMember(this.prisma, groupId, userId);
    if (already) {
      throw new ConflictError(
        `User ${userId} is already a member of group ${groupId}.`,
      );
    }

    await this.prisma.$transaction(async (tx: any) => {
      await GroupRepository.addMember(tx, groupId, userId);
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'add_group_member',
        target_user_id: userId,
        target_entity_type: 'Group',
        target_entity_id: String(groupId),
        details: { group_name: group.name },
      });
    });
  }

  async removeMember(
    groupId: number,
    userId: number,
    actorId: number,
  ): Promise<void> {
    const group = await GroupRepository.findById(this.prisma, groupId);
    if (!group) throw new NotFoundError(`Group ${groupId} not found`);

    const isMember = await GroupRepository.isMember(
      this.prisma,
      groupId,
      userId,
    );
    if (!isMember) {
      throw new NotFoundError(
        `User ${userId} is not a member of group ${groupId}.`,
      );
    }

    await this.prisma.$transaction(async (tx: any) => {
      await GroupRepository.removeMember(tx, groupId, userId);
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'remove_group_member',
        target_user_id: userId,
        target_entity_type: 'Group',
        target_entity_id: String(groupId),
        details: { group_name: group.name },
      });
    });
  }

  // --------------------------------------------------------------------
  // Search + user-membership helpers
  // --------------------------------------------------------------------

  async searchUsersNotInGroup(
    groupId: number,
    q: string,
    limit = 25,
  ): Promise<UserSearchResult[]> {
    // Validate group exists so callers get a clean 404 instead of empty hits.
    const group = await GroupRepository.findById(this.prisma, groupId);
    if (!group) throw new NotFoundError(`Group ${groupId} not found`);

    const trimmed = (q ?? '').trim();
    if (trimmed.length < MIN_SEARCH_LEN) return [];

    return GroupRepository.searchUsersNotInGroup(
      this.prisma,
      groupId,
      trimmed,
      limit,
    );
  }

  async listGroupsForUser(
    userId: number,
  ): Promise<Array<{ id: number; name: string }>> {
    const rows = await GroupRepository.listGroupsForUser(this.prisma, userId);
    return rows.map((g) => ({ id: g.id, name: g.name }));
  }

  // --------------------------------------------------------------------
  // Permission helpers
  // --------------------------------------------------------------------

  /**
   * Return the effective permissions for a user by reading the three
   * boolean columns directly from the User row.
   *
   * Sprint 027 T002: permission flags moved from Group to User.
   * A non-existent userId returns all false (findUnique returns null).
   */
  async userPermissions(userId: number): Promise<{
    oauthClient: boolean;
    llmProxy: boolean;
    leagueAccount: boolean;
  }> {
    const user = await (this.prisma as any).user.findUnique({
      where: { id: userId },
      select: {
        allows_oauth_client: true,
        allows_llm_proxy: true,
        allows_league_account: true,
      },
    });
    return {
      oauthClient: user?.allows_oauth_client ?? false,
      llmProxy: user?.allows_llm_proxy ?? false,
      leagueAccount: user?.allows_league_account ?? false,
    };
  }
}
