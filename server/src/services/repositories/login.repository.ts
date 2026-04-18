/**
 * LoginRepository — typed CRUD for the Login entity.
 *
 * All methods accept a DbClient as their first argument so they can be
 * composed inside a service-owned transaction without holding state.
 *
 * The unique constraint (provider, provider_user_id) prevents duplicate OAuth
 * identities. FK to User uses onDelete: Restrict — deleting a user that still
 * has Login rows will throw a Prisma FK error.
 */
import type { Login } from '../../generated/prisma/client.js';
import type { DbClient } from './types.js';

export type CreateLoginInput = {
  user_id: number;
  provider: string;
  provider_user_id: string;
  provider_email?: string | null;
};

export class LoginRepository {
  static async create(db: DbClient, data: CreateLoginInput): Promise<Login> {
    return (db as any).login.create({ data });
  }

  static async findById(db: DbClient, id: number): Promise<Login | null> {
    return (db as any).login.findUnique({ where: { id } });
  }

  /**
   * Find the login record matching a provider + provider-scoped user ID.
   * Used during OAuth callback to look up the associated User.
   */
  static async findByProvider(
    db: DbClient,
    provider: string,
    provider_user_id: string,
  ): Promise<Login | null> {
    return (db as any).login.findUnique({
      where: { provider_provider_user_id: { provider, provider_user_id } },
    });
  }

  /** Return all login records attached to a user. */
  static async findAllByUser(db: DbClient, user_id: number): Promise<Login[]> {
    return (db as any).login.findMany({ where: { user_id }, orderBy: { created_at: 'asc' } });
  }

  static async delete(db: DbClient, id: number): Promise<Login> {
    return (db as any).login.delete({ where: { id } });
  }
}
