/**
 * GroupRepository — typed CRUD for the Group entity and the UserGroup
 * many-to-many membership table (Sprint 012 T001).
 *
 * All methods accept a DbClient as their first argument so they can be
 * composed inside a service-owned transaction without holding state.
 *
 * The repository owns SQL for:
 *  - Group CRUD and member-count aggregation.
 *  - UserGroup insert/delete and bulk wipe ("delete all memberships for
 *    a group" used by GroupService.delete).
 *  - Cross-user+login search scoped to "users not already in this group"
 *    used by the admin "add member" autocomplete.
 *  - Per-user membership list used by the /users/:id page.
 */
import type { Group, User } from '../../generated/prisma/client.js';
import type { DbClient } from './types.js';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

export type CreateGroupInput = {
  name: string;
  description?: string | null;
};

export type UpdateGroupInput = Partial<{
  name: string;
  description: string | null;
}>;

/** Field that matched a search hit. */
export type UserSearchMatch =
  | 'display_name'
  | 'primary_email'
  | 'provider_email'
  | 'provider_username';

export type UserSearchResult = {
  id: number;
  displayName: string;
  email: string;
  matchedOn: UserSearchMatch;
};

export type GroupWithMemberCount = Group & { memberCount: number };

export type MemberRow = User & {
  external_accounts: Array<{ type: string; status: string; external_id: string | null }>;
  allows_oauth_client: boolean;
  allows_llm_proxy: boolean;
  allows_league_account: boolean;
};

// ---------------------------------------------------------------------------
// GroupRepository
// ---------------------------------------------------------------------------

export class GroupRepository {
  // ---- Group CRUD --------------------------------------------------------

  static async create(db: DbClient, data: CreateGroupInput): Promise<Group> {
    return (db as any).group.create({
      data: {
        name: data.name,
        description: data.description ?? null,
      },
    });
  }

  static async findById(db: DbClient, id: number): Promise<Group | null> {
    return (db as any).group.findUnique({ where: { id } });
  }

  static async findByName(db: DbClient, name: string): Promise<Group | null> {
    return (db as any).group.findUnique({ where: { name } });
  }

  /**
   * Return every group with a `memberCount` field attached. Uses Prisma's
   * built-in `_count` selector; no manual aggregation required.
   */
  static async findAllWithMemberCount(db: DbClient): Promise<GroupWithMemberCount[]> {
    const rows = await (db as any).group.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { users: true } } },
    });
    return rows.map((r: any) => ({
      id: r.id,
      name: r.name,
      description: r.description,
      created_at: r.created_at,
      updated_at: r.updated_at,
      memberCount: r._count?.users ?? 0,
    }));
  }

  static async update(
    db: DbClient,
    id: number,
    data: UpdateGroupInput,
  ): Promise<Group> {
    return (db as any).group.update({ where: { id }, data });
  }

  /**
   * Find a Group by name, or create it if none exists. Idempotent — safe
   * to call on every sync cycle for the same OU name.
   *
   * Returns `{ group, created }` where `created` is true when the row was
   * inserted.
   */
  static async upsertByName(
    db: DbClient,
    name: string,
    description?: string | null,
  ): Promise<{ group: Group; created: boolean }> {
    const existing = await (db as any).group.findUnique({ where: { name } });
    if (existing) {
      return { group: existing, created: false };
    }
    const group = await (db as any).group.create({
      data: { name, description: description ?? null },
    });
    return { group, created: true };
  }

  /**
   * Delete a Group row. Caller is expected to wipe `UserGroup` rows first
   * inside the same transaction — FK has `onDelete: Cascade` so this
   * still works if skipped, but GroupService deliberately deletes
   * memberships explicitly so the audit event's `memberCount` detail is
   * calculated from a known state.
   */
  static async delete(db: DbClient, id: number): Promise<Group> {
    return (db as any).group.delete({ where: { id } });
  }

  // ---- Membership CRUD ---------------------------------------------------

  static async addMember(
    db: DbClient,
    groupId: number,
    userId: number,
  ): Promise<void> {
    await (db as any).userGroup.create({
      data: { group_id: groupId, user_id: userId },
    });
  }

  /** Returns `true` if a row was deleted, `false` if no membership existed. */
  static async removeMember(
    db: DbClient,
    groupId: number,
    userId: number,
  ): Promise<boolean> {
    const result = await (db as any).userGroup.deleteMany({
      where: { group_id: groupId, user_id: userId },
    });
    return (result.count ?? 0) > 0;
  }

  static async isMember(
    db: DbClient,
    groupId: number,
    userId: number,
  ): Promise<boolean> {
    const row = await (db as any).userGroup.findUnique({
      where: { user_id_group_id: { user_id: userId, group_id: groupId } },
    });
    return row !== null;
  }

  static async countMembers(db: DbClient, groupId: number): Promise<number> {
    return (db as any).userGroup.count({ where: { group_id: groupId } });
  }

  /**
   * Delete every UserGroup row for a group. Used by GroupService.delete
   * inside the same transaction as the Group delete so the `memberCount`
   * detail attached to the audit event reflects the pre-delete state.
   */
  static async deleteMembershipsForGroup(
    db: DbClient,
    groupId: number,
  ): Promise<number> {
    const result = await (db as any).userGroup.deleteMany({
      where: { group_id: groupId },
    });
    return result.count ?? 0;
  }

  // ---- Read helpers ------------------------------------------------------

  /**
   * List active members of a group, ordered by display_name, with each
   * user's external_accounts preloaded (same projection shape as
   * `/admin/cohorts/:id/members`).
   */
  static async listMembers(
    db: DbClient,
    groupId: number,
  ): Promise<MemberRow[]> {
    const rows = await (db as any).userGroup.findMany({
      where: { group_id: groupId, user: { is_active: true } },
      include: {
        user: {
          include: {
            external_accounts: {
              select: { type: true, status: true, external_id: true },
            },
            llm_proxy_tokens: {
              select: { revoked_at: true, expires_at: true },
              orderBy: { created_at: 'desc' as any },
              take: 1,
            },
          },
        },
      },
    });
    const members = rows.map((r: any) => r.user).filter(Boolean);
    members.sort((a: any, b: any) => {
      const an = (a.display_name ?? '').toLowerCase();
      const bn = (b.display_name ?? '').toLowerCase();
      return an.localeCompare(bn);
    });
    return members;
  }

  /** Return the groups a user belongs to, ordered by group name. */
  static async listGroupsForUser(
    db: DbClient,
    userId: number,
  ): Promise<Group[]> {
    const rows = await (db as any).userGroup.findMany({
      where: { user_id: userId },
      include: { group: true },
    });
    const groups = rows.map((r: any) => r.group).filter(Boolean);
    groups.sort((a: any, b: any) => a.name.localeCompare(b.name));
    return groups;
  }

  /**
   * Case-insensitive substring search across four fields, scoped to
   * active users not already in the given group. Returns up to `limit`
   * results (default 25). Callers should handle empty/short queries —
   * this method does not validate `q`.
   *
   * Match priority for `matchedOn` attribution:
   *   1. display_name
   *   2. primary_email
   *   3. provider_email  (via any Login)
   *   4. provider_username (via any Login)
   *
   * Implementation note: SQLite's default LIKE is ASCII-case-insensitive
   * ("like('%amy%')" matches 'Amy'), which suits dev/test. For Postgres,
   * Prisma exposes `mode: 'insensitive'` but that is rejected by the
   * SQLite adapter. The shared project target is SQLite-first (see
   * `.claude/rules/architecture.md`), so we rely on SQLite's default
   * behaviour and a post-query attribution pass for `matchedOn`.
   */
  static async searchUsersNotInGroup(
    db: DbClient,
    groupId: number,
    q: string,
    limit = 25,
  ): Promise<UserSearchResult[]> {
    // Run a broad OR query, then attribute matched-on locally so we do
    // not have to join the Login table four times at the SQL layer.
    const rows = await (db as any).user.findMany({
      where: {
        is_active: true,
        groups: { none: { group_id: groupId } },
        OR: [
          { display_name: { contains: q } },
          { primary_email: { contains: q } },
          {
            logins: {
              some: { provider_email: { contains: q } },
            },
          },
          {
            logins: {
              some: {
                provider_username: { contains: q },
              },
            },
          },
        ],
      },
      include: {
        logins: {
          select: { provider_email: true, provider_username: true },
        },
      },
      take: limit,
      orderBy: { display_name: 'asc' },
    });

    const needle = q.toLowerCase();
    return rows.map((u: any) => {
      let matchedOn: UserSearchMatch = 'display_name';
      const name = (u.display_name ?? '').toLowerCase();
      const email = (u.primary_email ?? '').toLowerCase();
      if (name.includes(needle)) {
        matchedOn = 'display_name';
      } else if (email.includes(needle)) {
        matchedOn = 'primary_email';
      } else {
        const loginEmailHit = (u.logins ?? []).some(
          (l: any) => l.provider_email && l.provider_email.toLowerCase().includes(needle),
        );
        if (loginEmailHit) {
          matchedOn = 'provider_email';
        } else {
          matchedOn = 'provider_username';
        }
      }
      return {
        id: u.id,
        displayName: u.display_name ?? '',
        email: u.primary_email ?? '',
        matchedOn,
      };
    });
  }
}
