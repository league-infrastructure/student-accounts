/**
 * UserService — domain logic for the User entity.
 *
 * Responsibilities:
 *  - User CRUD with repository delegation
 *  - Audit event recording for state-changing operations
 *  - Enforce the onDelete: Restrict invariant on User deletion
 *    (Login and ExternalAccount rows must be cleared first)
 *
 * Transaction boundary: every multi-step write opens a prisma.$transaction.
 */

import { ConflictError, NotFoundError, UnauthorizedError, ValidationError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import { UserRepository } from './repositories/user.repository.js';
import { LoginRepository } from './repositories/login.repository.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import type { User } from '../generated/prisma/client.js';
import type { FindAllUsersFilter } from './repositories/user.repository.js';
import { hashPassword, verifyPassword } from '../utils/password.js';
import { Prisma } from '../generated/prisma/client.js';

export class UserService {
  constructor(
    private prisma: any,
    private audit: AuditService,
  ) {}

  /**
   * Create a User and record a `create_user` audit event atomically.
   *
   * Both writes happen inside a single Prisma interactive transaction. If
   * either write fails the entire transaction rolls back — no partial state
   * can reach the database.
   *
   * @param data         - Required fields for the new User.
   * @param actorId      - The user performing this action; null for system.
   */
  async createWithAudit(
    data: {
      display_name: string;
      primary_email: string;
      created_via: 'social_login' | 'pike13_sync' | 'admin_created' | 'passphrase_signup';
      role?: 'student' | 'staff' | 'admin';
      cohort_id?: number | null;
      approval_status?: 'approved' | 'pending';
      onboarding_completed?: boolean;
    },
    actorId: number | null = null,
  ): Promise<User> {
    return this.prisma.$transaction(async (tx: any) => {
      const user = await UserRepository.create(tx, data);
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'create_user',
        target_user_id: user.id,
        target_entity_type: 'User',
        target_entity_id: String(user.id),
      });
      return user;
    });
  }

  /**
   * Find a User by its primary key.
   * Throws NotFoundError if the user does not exist.
   */
  async findById(id: number): Promise<User> {
    const user = await UserRepository.findById(this.prisma, id);
    if (!user) throw new NotFoundError(`User ${id} not found`);
    return user;
  }

  /**
   * Find a User by primary key, including inactive users.
   * Used by admin detail views that need to inspect deactivated/merged users.
   * Throws NotFoundError if no record exists at all.
   */
  async findByIdIncludingInactive(id: number): Promise<User> {
    const user = await UserRepository.findByIdIncludingInactive(this.prisma, id);
    if (!user) throw new NotFoundError(`User ${id} not found`);
    return user;
  }

  /**
   * Find a User by primary email address.
   * Returns null if no matching user exists.
   */
  async findByEmail(email: string): Promise<User | null> {
    return UserRepository.findByEmail(this.prisma, email);
  }

  /**
   * Return all users, optionally filtered by role and/or cohort.
   */
  async findAll(filters?: FindAllUsersFilter): Promise<User[]> {
    return UserRepository.findAll(this.prisma, filters);
  }

  /**
   * Assign the user to a cohort and record an `assign_cohort` audit event
   * atomically.
   *
   * Throws NotFoundError if the user does not exist.
   */
  async updateCohort(
    userId: number,
    cohortId: number | null,
    actorId: number | null = null,
  ): Promise<User> {
    // Verify user exists before opening the transaction
    const user = await UserRepository.findById(this.prisma, userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    return this.prisma.$transaction(async (tx: any) => {
      const updated = await UserRepository.update(tx, userId, { cohort_id: cohortId });
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'assign_cohort',
        target_user_id: userId,
        target_entity_type: 'User',
        target_entity_id: String(userId),
        details: { cohort_id: cohortId },
      });
      return updated;
    });
  }

  /**
   * Delete a User.
   *
   * The DB enforces `onDelete: Restrict` on Login and ExternalAccount FKs.
   * This method checks for dependent rows before calling the DB delete and
   * surfaces a ConflictError rather than propagating a raw Prisma FK error.
   *
   * Throws NotFoundError if the user does not exist.
   * Throws ConflictError if the user still has Login or ExternalAccount rows.
   */
  async delete(userId: number): Promise<void> {
    const user = await UserRepository.findById(this.prisma, userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    const logins = await LoginRepository.findAllByUser(this.prisma, userId);
    if (logins.length > 0) {
      throw new ConflictError(
        `Cannot delete user ${userId}: ${logins.length} login(s) must be removed first`,
      );
    }

    const accounts = await ExternalAccountRepository.findAllByUser(this.prisma, userId);
    if (accounts.length > 0) {
      throw new ConflictError(
        `Cannot delete user ${userId}: ${accounts.length} external account(s) must be removed first`,
      );
    }

    await UserRepository.delete(this.prisma, userId);
  }

  // -------------------------------------------------------------------------
  // Credential update (Sprint 020 T003)
  // -------------------------------------------------------------------------

  /**
   * Update the user's own username and/or password.
   *
   * Rules:
   *  - currentPassword is always required and verified against the stored hash.
   *  - At least one of username or newPassword must be provided.
   *  - Empty/whitespace-only newPassword is a ValidationError (400).
   *  - Username uniqueness is enforced by the DB unique constraint (→ ConflictError).
   *
   * @returns { id, username } — never exposes password_hash.
   */
  async updateCredentials(
    userId: number,
    patch: {
      username?: string;
      currentPassword: string;
      newPassword?: string;
    },
  ): Promise<{ id: number; username: string | null }> {
    // 1. Load the user; not-found maps to 401 (actor is the signed-in user).
    const user = await UserRepository.findById(this.prisma, userId);
    if (!user) throw new UnauthorizedError('Session user not found');

    // 2. Verify current password.
    const stored = (user as any).password_hash as string | null;
    if (!stored) throw new UnauthorizedError('Account has no password set');
    const match = await verifyPassword(patch.currentPassword, stored);
    if (!match) throw new UnauthorizedError('Current password is incorrect');

    // 3. Validate the patch payload.
    const hasNewPassword = patch.newPassword !== undefined;
    const hasUsername = patch.username !== undefined;
    if (!hasNewPassword && !hasUsername) {
      throw new ValidationError('At least one of username or newPassword must be provided');
    }
    if (hasNewPassword) {
      const trimmed = (patch.newPassword ?? '').trim();
      if (trimmed.length === 0) {
        throw new ValidationError('newPassword must not be empty');
      }
    }

    // 4. Build the update payload.
    const data: Record<string, unknown> = {};
    if (hasNewPassword) {
      data['password_hash'] = await hashPassword(patch.newPassword!);
    }
    if (hasUsername) {
      const trimmed = (patch.username ?? '').trim().toLowerCase();
      if (trimmed.length < 2 || trimmed.length > 32) {
        throw new ValidationError('Username must be 2–32 characters');
      }
      if (!/^[a-z0-9._-]+$/.test(trimmed)) {
        throw new ValidationError(
          'Username must contain only letters, numbers, dots, dashes, underscores',
        );
      }
      data['username'] = trimmed;
    }

    // 5. Update and record audit event atomically.
    try {
      return await this.prisma.$transaction(async (tx: any) => {
        const updated = await tx.user.update({ where: { id: userId }, data });
        await this.audit.record(tx, {
          actor_user_id: userId,
          action: 'account_credentials_updated',
          target_user_id: userId,
          target_entity_type: 'User',
          target_entity_id: String(userId),
          details: {
            updated_username: hasUsername,
            updated_password: hasNewPassword,
          },
        });
        return { id: updated.id, username: (updated as any).username ?? null };
      });
    } catch (err) {
      if (
        err instanceof Prisma.PrismaClientKnownRequestError &&
        err.code === 'P2002'
      ) {
        throw new ConflictError('That username is already taken');
      }
      throw err;
    }
  }

  // -------------------------------------------------------------------------
  // Legacy methods retained for compatibility with routes from prior sprints.
  // These delegate to the repository directly without audit events.
  // -------------------------------------------------------------------------

  /** @deprecated Use findAll() instead. */
  async list(): Promise<User[]> {
    return UserRepository.findAll(this.prisma);
  }

  /** @deprecated Use findById() instead. */
  async getById(id: number): Promise<User> {
    return this.findById(id);
  }

  /** @deprecated Use findByEmail() instead. */
  async getByEmail(email: string): Promise<User | null> {
    return this.findByEmail(email);
  }

  async count(): Promise<number> {
    return this.prisma.user.count();
  }

  /**
   * Legacy create used by admin routes. Maps template-style field names
   * to the domain schema. Does not record an audit event.
   * @deprecated Use createWithAudit() instead.
   */
  async create(data: { email?: string; displayName?: string; role?: string }): Promise<User> {
    return UserRepository.create(this.prisma, {
      primary_email: data.email ?? 'unknown@example.com',
      display_name: data.displayName ?? data.email ?? 'Unknown',
      role: mapRole(data.role),
      created_via: 'admin_created',
    });
  }

  /**
   * Legacy update used by admin routes. Maps template-style field names
   * to the domain schema. Does not record an audit event.
   * @deprecated Use updateCohort() or the repository directly instead.
   */
  async update(
    id: number,
    data: { email?: string; displayName?: string; role?: string },
  ): Promise<User> {
    return UserRepository.update(this.prisma, id, {
      ...(data.email !== undefined ? { primary_email: data.email } : {}),
      ...(data.displayName !== undefined ? { display_name: data.displayName } : {}),
      ...(data.role !== undefined ? { role: mapRole(data.role) } : {}),
    });
  }

  /**
   * Legacy role update. Does not record an audit event.
   * @deprecated
   */
  async updateRole(id: number, role: string): Promise<User> {
    return UserRepository.update(this.prisma, id, { role: mapRole(role) });
  }

  // -------------------------------------------------------------------------
  // Per-user permission flags (Sprint 027 T003)
  // -------------------------------------------------------------------------

  /**
   * Atomically update one or more per-user permission flags and record a
   * `user_permission_changed` audit event in the same transaction.
   *
   * Any combination of the three boolean fields may be included in `patch`;
   * omitted fields are left unchanged.  If `patch` is empty the User row is
   * still read so the current permission state can be returned, but no write
   * is issued.
   *
   * Returns the updated permission state along with a `leagueAccountFlipped`
   * flag that is `true` when `allows_league_account` transitioned from `false`
   * to `true` in this call.  The caller (route handler) uses this to decide
   * whether to trigger `provisionUserIfNeeded` as a fail-soft side-effect.
   *
   * @param userId  - Target user primary key.
   * @param patch   - Partial permission update; at least one field is typical.
   * @param actorId - Admin performing the change; null for system actions.
   * @returns Updated permission state plus transition indicator.
   */
  async setPermissions(
    userId: number,
    patch: {
      allows_oauth_client?: boolean;
      allows_llm_proxy?: boolean;
      allows_league_account?: boolean;
    },
    actorId: number | null = null,
  ): Promise<{
    allowsOauthClient: boolean;
    allowsLlmProxy: boolean;
    allowsLeagueAccount: boolean;
    leagueAccountFlipped: boolean;
    llmProxyFlipped: boolean;
  }> {
    const user = await UserRepository.findByIdIncludingInactive(this.prisma, userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    const hasChanges =
      patch.allows_oauth_client !== undefined ||
      patch.allows_llm_proxy !== undefined ||
      patch.allows_league_account !== undefined;

    const before = {
      allows_oauth_client: (user as any).allows_oauth_client as boolean,
      allows_llm_proxy: (user as any).allows_llm_proxy as boolean,
      allows_league_account: (user as any).allows_league_account as boolean,
    };

    if (!hasChanges) {
      // No-op: return current state without touching the database.
      return {
        allowsOauthClient: before.allows_oauth_client,
        allowsLlmProxy: before.allows_llm_proxy,
        allowsLeagueAccount: before.allows_league_account,
        leagueAccountFlipped: false,
        llmProxyFlipped: false,
      };
    }

    const after = {
      allows_oauth_client: patch.allows_oauth_client ?? before.allows_oauth_client,
      allows_llm_proxy: patch.allows_llm_proxy ?? before.allows_llm_proxy,
      allows_league_account: patch.allows_league_account ?? before.allows_league_account,
    };

    await this.prisma.$transaction(async (tx: any) => {
      await tx.user.update({ where: { id: userId }, data: patch });
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'user_permission_changed',
        target_user_id: userId,
        target_entity_type: 'User',
        target_entity_id: String(userId),
        details: { before, after },
      });
    });

    const leagueAccountFlipped =
      !before.allows_league_account && after.allows_league_account;
    const llmProxyFlipped = !before.allows_llm_proxy && after.allows_llm_proxy;

    return {
      allowsOauthClient: after.allows_oauth_client,
      allowsLlmProxy: after.allows_llm_proxy,
      allowsLeagueAccount: after.allows_league_account,
      leagueAccountFlipped,
      llmProxyFlipped,
    };
  }
}

/** Map legacy USER/ADMIN role strings to domain enum values. */
function mapRole(role: string | undefined): 'student' | 'staff' | 'admin' {
  if (role === 'ADMIN') return 'admin';
  if (role === 'USER') return 'student';
  if (role === 'admin' || role === 'staff' || role === 'student') return role;
  return 'student';
}
