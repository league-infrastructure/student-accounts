/**
 * LoginService — domain logic for the Login entity.
 *
 * Responsibilities:
 *  - Create / delete Login records
 *  - Enforce the (provider, provider_user_id) uniqueness invariant
 *  - Enforce the "at least one Login" invariant on delete
 *  - Record audit events for state-changing operations
 *
 * Note: OAuth flow integration is deferred to a later sprint.
 */

import { ConflictError, NotFoundError, ValidationError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import { LoginRepository } from './repositories/login.repository.js';
import type { Login } from '../generated/prisma/client.js';

export class LoginService {
  constructor(
    private prisma: any,
    private audit: AuditService,
  ) {}

  /**
   * Create a Login and record an `add_login` audit event atomically.
   *
   * Throws ConflictError if the (provider, providerUserId) pair is already
   * associated with any user.
   */
  async create(
    userId: number,
    provider: string,
    providerUserId: string,
    providerEmail?: string | null,
    actorId: number | null = null,
  ): Promise<Login> {
    // Pre-check for duplicate — surfaces a domain error before hitting the DB
    // constraint so the caller gets a ConflictError rather than a Prisma error.
    const existing = await LoginRepository.findByProvider(this.prisma, provider, providerUserId);
    if (existing) {
      throw new ConflictError(
        `Login (${provider}, ${providerUserId}) is already associated with a user`,
      );
    }

    return this.prisma.$transaction(async (tx: any) => {
      const login = await LoginRepository.create(tx, {
        user_id: userId,
        provider,
        provider_user_id: providerUserId,
        provider_email: providerEmail ?? null,
      });
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'add_login',
        target_user_id: userId,
        target_entity_type: 'Login',
        target_entity_id: String(login.id),
        details: { provider },
      });
      return login;
    });
  }

  /**
   * Find the Login record for a given provider + provider-scoped user ID.
   * Returns null if no matching record exists.
   */
  async findByProvider(provider: string, providerUserId: string): Promise<Login | null> {
    return LoginRepository.findByProvider(this.prisma, provider, providerUserId);
  }

  /** Return all Login records for a user. */
  async findAllByUser(userId: number): Promise<Login[]> {
    return LoginRepository.findAllByUser(this.prisma, userId);
  }

  /**
   * Delete a Login and record a `remove_login` audit event atomically.
   *
   * Throws NotFoundError if the login does not exist.
   * Throws ValidationError if deleting this login would leave the user with
   * zero logins (enforcing the "at least one login" invariant).
   */
  async delete(loginId: number, actorId: number | null = null): Promise<void> {
    const login = await LoginRepository.findById(this.prisma, loginId);
    if (!login) throw new NotFoundError(`Login ${loginId} not found`);

    const remaining = await LoginRepository.findAllByUser(this.prisma, login.user_id);
    if (remaining.length <= 1) {
      throw new ValidationError(
        `Cannot remove the last login for user ${login.user_id}`,
      );
    }

    await this.prisma.$transaction(async (tx: any) => {
      await LoginRepository.delete(tx, loginId);
      await this.audit.record(tx, {
        actor_user_id: actorId,
        action: 'remove_login',
        target_user_id: login.user_id,
        target_entity_type: 'Login',
        target_entity_id: String(loginId),
        details: { provider: login.provider },
      });
    });
  }
}
