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
import { generatePassword, hashPassword, makeCryptHash, verifyPassword } from '../utils/password.js';
import { Prisma } from '../generated/prisma/client.js';
import {
  LAPTOP_USERNAME_RULES_MESSAGE,
  LAPTOP_USERNAME_TAKEN_MESSAGE,
  type LaptopAccountService,
} from './laptop/laptop-account.service.js';
import { isValidRosterId } from './laptop/roster-ids.js';

/** Shortest password an admin may type for a student (generated ones are longer). */
export const ADMIN_PASSWORD_MIN_LENGTH = 4;

export class UserService {
  constructor(
    private prisma: any,
    private audit: AuditService,
    /**
     * Laptop roster write-back (sprint 002 T004). Optional so older tests
     * can construct the service without it; when absent, credential changes
     * do not touch the roster and the roster-ownership username check is
     * skipped (the shape rules still apply).
     */
    private laptopAccounts?: LaptopAccountService,
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
   *  - currentPassword is required unless the user is in first-time setup
   *    (has neither a username nor a password_hash). In that case the patch
   *    is accepted without it (the route sets allowFirstTimeSetup=true after
   *    verifying the user has no credentials at all).
   *  - At least one of username or newPassword must be provided.
   *  - Empty/whitespace-only newPassword is a ValidationError (400).
   *  - Username shape follows `validateUsername` (laptop rules by default).
   *  - Username uniqueness is enforced by the DB unique constraint (→ ConflictError).
   *  - A new password is stored twice: scrypt in `password_hash` and SHA-512
   *    crypt in `laptop_password_hash` for the laptop roster (sprint 002 T004).
   *  - After the write the laptop roster is reconciled; that never throws.
   *
   * @returns { id, username } — never exposes password_hash.
   */
  async updateCredentials(
    userId: number,
    patch: {
      username?: string;
      currentPassword?: string;
      newPassword?: string;
      allowFirstTimeSetup?: boolean;
    },
  ): Promise<{ id: number; username: string | null }> {
    // 1. Load the user; not-found maps to 401 (actor is the signed-in user).
    const user = await UserRepository.findById(this.prisma, userId);
    if (!user) throw new UnauthorizedError('Session user not found');

    // 2. Verify current password — unless this is a first-time setup call.
    const stored = (user as any).password_hash as string | null;
    if (!patch.allowFirstTimeSetup) {
      if (!stored) throw new UnauthorizedError('Account has no password set');
      if (!patch.currentPassword) throw new UnauthorizedError('currentPassword is required');
      const match = await verifyPassword(patch.currentPassword, stored);
      if (!match) throw new UnauthorizedError('Current password is incorrect');
    }

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

    // 4. Build the update payload (username rules first: no hashing for a
    //    request that is going to be rejected anyway).
    const data = await this.credentialData(user, {
      username: hasUsername ? (patch.username ?? '') : undefined,
      password: hasNewPassword ? patch.newPassword : undefined,
    });

    // 5. Update and record audit event atomically.
    let result: { id: number; username: string | null };
    try {
      result = await this.prisma.$transaction(async (tx: any) => {
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

    // 6. Write-back to the laptop roster. Never throws: a failure marks the
    //    user dirty and the hourly laptop-roster-push job retries.
    if (this.laptopAccounts) await this.laptopAccounts.reconcile(userId, userId);

    return result;
  }

  // -------------------------------------------------------------------------
  // Admin credential set (sprint 002 T005, SUC-003)
  // -------------------------------------------------------------------------

  /**
   * Set a user's username and/or password on their behalf (admin only).
   *
   * Differences from `updateCredentials`: no current password is needed, the
   * actor is the admin, a password can be generated (three words, see
   * `generatePassword`), and a typed password must be at least
   * `ADMIN_PASSWORD_MIN_LENGTH` characters. Everything else is shared: the
   * username rules (laptop rules when `allows_laptop_account`), scrypt plus
   * `laptop_password_hash`, the `username` Login row when the user has none
   * (`provider_user_id: 'admin:<userId>:<username>'`), and the roster
   * write-back, which never throws.
   *
   * Audits `admin_set_username` and `admin_set_password` separately; neither
   * carries the password.
   *
   * @returns `{ username, password? }` — `password` is the plaintext only
   *          when one was set or generated in this call. It is not stored
   *          and cannot be read back later.
   * @throws NotFoundError (404), ValidationError (shape; the route maps it to
   *         400), ConflictError (409, username taken).
   */
  async setCredentialsByAdmin(
    userId: number,
    patch: { username?: string; password?: string; generatePassword?: boolean },
    actorId: number | null,
  ): Promise<{ username: string | null; password?: string }> {
    const user = await UserRepository.findByIdIncludingInactive(this.prisma, userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    const hasUsername = patch.username !== undefined;
    const hasTypedPassword = patch.password !== undefined;
    const generate = patch.generatePassword === true;
    if (!hasUsername && !hasTypedPassword && !generate) {
      throw new ValidationError('Provide a username, a password, or generatePassword: true');
    }
    if (hasTypedPassword && generate) {
      throw new ValidationError('Provide either password or generatePassword, not both');
    }

    let password: string | undefined;
    if (generate) {
      password = generatePassword();
    } else if (hasTypedPassword) {
      const typed = patch.password ?? '';
      if (typed.trim().length === 0) throw new ValidationError('Password must not be empty');
      if (typed.length < ADMIN_PASSWORD_MIN_LENGTH) {
        throw new ValidationError(`Password must be at least ${ADMIN_PASSWORD_MIN_LENGTH} characters`);
      }
      password = typed;
    }

    const data = await this.credentialData(user, {
      username: hasUsername ? (patch.username ?? '') : undefined,
      password,
    });

    let username: string | null;
    try {
      username = await this.prisma.$transaction(async (tx: any) => {
        const updated = await tx.user.update({ where: { id: userId }, data });
        const finalUsername: string | null = updated.username ?? null;

        // The same Login row passphrase signup / first-time setup creates, so
        // the user shows up as a username login everywhere else in the app.
        if (finalUsername) {
          const logins = await LoginRepository.findAllByUser(tx, userId);
          if (!logins.some((l) => l.provider === 'username')) {
            await LoginRepository.create(tx, {
              user_id: userId,
              provider: 'username',
              provider_user_id: `admin:${userId}:${finalUsername}`,
              provider_email: updated.primary_email ?? null,
              provider_username: finalUsername,
            });
          }
        }

        const base = {
          actor_user_id: actorId,
          target_user_id: userId,
          target_entity_type: 'User',
          target_entity_id: String(userId),
        };
        if (hasUsername) {
          await this.audit.record(tx, {
            ...base,
            action: 'admin_set_username',
            details: { username: finalUsername },
          });
        }
        if (password !== undefined) {
          await this.audit.record(tx, {
            ...base,
            action: 'admin_set_password',
            details: { generated: generate },
          });
        }
        return finalUsername;
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictError('That username is already taken');
      }
      throw err;
    }

    if (this.laptopAccounts) await this.laptopAccounts.reconcile(userId, actorId);

    return password !== undefined ? { username, password } : { username };
  }

  /**
   * The User columns a credential change writes: the validated username and,
   * for a new password, both hash forms. Shared by the self-service and admin
   * paths so the two can never drift.
   */
  private async credentialData(
    user: { id: number; allows_laptop_account?: boolean },
    patch: { username?: string; password?: string },
  ): Promise<Record<string, unknown>> {
    const data: Record<string, unknown> = {};
    if (patch.username !== undefined) {
      data['username'] = await this.validateUsername(patch.username, user);
    }
    if (patch.password !== undefined) {
      data['password_hash'] = await hashPassword(patch.password);
      // The plaintext is only in hand here, so the laptop roster's crypt
      // form is computed now and kept for later rewrites (push-all, merges).
      data['laptop_password_hash'] = makeCryptHash(patch.password);
    }
    return data;
  }

  /**
   * Normalise and validate a username for `user` (sprint 002 T004).
   *
   * With `allows_laptop_account` on (the default) the laptop rules apply so
   * the same name works at a laptop login screen: `isValidRosterId` (3–32
   * chars of `[a-z0-9-]`, starting with a letter or digit, not a reserved
   * system name; case is NOT folded, Unix logins are case-sensitive) and the
   * roster must not already hold that id for somebody else. With the flag
   * off the legacy rules apply: 2–32 chars of `[a-z0-9._-]`, lower-cased.
   *
   * @throws ValidationError (400) on shape, ConflictError (409) when the
   *         roster id belongs to another account.
   */
  async validateUsername(
    raw: string,
    user: { id: number | null; allows_laptop_account?: boolean },
  ): Promise<string> {
    const trimmed = (raw ?? '').trim();
    if (user.allows_laptop_account ?? true) {
      if (!isValidRosterId(trimmed)) throw new ValidationError(LAPTOP_USERNAME_RULES_MESSAGE);
      if (this.laptopAccounts && (await this.laptopAccounts.rosterIdTakenByOther(trimmed, user.id))) {
        throw new ConflictError(LAPTOP_USERNAME_TAKEN_MESSAGE);
      }
      return trimmed;
    }
    const lower = trimmed.toLowerCase();
    if (lower.length < 2 || lower.length > 32) {
      throw new ValidationError('Username must be 2–32 characters');
    }
    if (!/^[a-z0-9._-]+$/.test(lower)) {
      throw new ValidationError(
        'Username must contain only letters, numbers, dots, dashes, underscores',
      );
    }
    return lower;
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
   * Any combination of the four boolean fields may be included in `patch`;
   * omitted fields are left unchanged.  If `patch` is empty the User row is
   * still read so the current permission state can be returned, but no write
   * is issued.
   *
   * Returns the updated permission state along with a `leagueAccountFlipped`
   * flag that is `true` when `allows_league_account` transitioned from `false`
   * to `true` in this call.  The caller (route handler) uses this to decide
   * whether to trigger `provisionUserIfNeeded` as a fail-soft side-effect.
   * `laptopAccountChanged` tells the caller to reconcile the laptop roster
   * (sprint 002 T004).
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
      allows_laptop_account?: boolean;
    },
    actorId: number | null = null,
  ): Promise<{
    allowsOauthClient: boolean;
    allowsLlmProxy: boolean;
    allowsLeagueAccount: boolean;
    allowsLaptopAccount: boolean;
    leagueAccountFlipped: boolean;
    llmProxyFlipped: boolean;
    llmProxyUnflipped: boolean;
    laptopAccountChanged: boolean;
  }> {
    const user = await UserRepository.findByIdIncludingInactive(this.prisma, userId);
    if (!user) throw new NotFoundError(`User ${userId} not found`);

    const hasChanges =
      patch.allows_oauth_client !== undefined ||
      patch.allows_llm_proxy !== undefined ||
      patch.allows_league_account !== undefined ||
      patch.allows_laptop_account !== undefined;

    const before = {
      allows_oauth_client: (user as any).allows_oauth_client as boolean,
      allows_llm_proxy: (user as any).allows_llm_proxy as boolean,
      allows_league_account: (user as any).allows_league_account as boolean,
      allows_laptop_account: (user as any).allows_laptop_account as boolean,
    };

    if (!hasChanges) {
      // No-op: return current state without touching the database.
      return {
        allowsOauthClient: before.allows_oauth_client,
        allowsLlmProxy: before.allows_llm_proxy,
        allowsLeagueAccount: before.allows_league_account,
        allowsLaptopAccount: before.allows_laptop_account,
        leagueAccountFlipped: false,
        llmProxyFlipped: false,
        llmProxyUnflipped: false,
        laptopAccountChanged: false,
      };
    }

    const after = {
      allows_oauth_client: patch.allows_oauth_client ?? before.allows_oauth_client,
      allows_llm_proxy: patch.allows_llm_proxy ?? before.allows_llm_proxy,
      allows_league_account: patch.allows_league_account ?? before.allows_league_account,
      allows_laptop_account: patch.allows_laptop_account ?? before.allows_laptop_account,
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
    const llmProxyUnflipped = before.allows_llm_proxy && !after.allows_llm_proxy;
    const laptopAccountChanged = before.allows_laptop_account !== after.allows_laptop_account;

    return {
      allowsOauthClient: after.allows_oauth_client,
      allowsLlmProxy: after.allows_llm_proxy,
      allowsLeagueAccount: after.allows_league_account,
      allowsLaptopAccount: after.allows_laptop_account,
      leagueAccountFlipped,
      llmProxyFlipped,
      llmProxyUnflipped,
      laptopAccountChanged,
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
