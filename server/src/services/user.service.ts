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

import { ConflictError, NotFoundError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import { UserRepository } from './repositories/user.repository.js';
import { LoginRepository } from './repositories/login.repository.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import type { User } from '../generated/prisma/client.js';
import type { FindAllUsersFilter } from './repositories/user.repository.js';

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
      created_via: 'social_login' | 'pike13_sync' | 'admin_created';
      role?: 'student' | 'staff' | 'admin';
      cohort_id?: number | null;
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
}

/** Map legacy USER/ADMIN role strings to domain enum values. */
function mapRole(role: string | undefined): 'student' | 'staff' | 'admin' {
  if (role === 'ADMIN') return 'admin';
  if (role === 'USER') return 'student';
  if (role === 'admin' || role === 'staff' || role === 'student') return role;
  return 'student';
}
