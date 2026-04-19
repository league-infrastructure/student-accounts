/**
 * UserRepository — typed CRUD for the User entity.
 *
 * All methods accept a DbClient as their first argument so they can be
 * composed inside a service-owned transaction without holding state.
 *
 * FK errors propagate as Prisma errors; callers may catch and re-wrap.
 */
import type { User } from '../../generated/prisma/client.js';
import type { DbClient } from './types.js';

export type CreateUserInput = {
  display_name: string;
  primary_email: string;
  role?: 'student' | 'staff' | 'admin';
  created_via: 'social_login' | 'pike13_sync' | 'admin_created' | 'workspace_sync';
  cohort_id?: number | null;
};

export type UpdateUserInput = Partial<{
  display_name: string;
  primary_email: string;
  role: 'student' | 'staff' | 'admin';
  cohort_id: number | null;
  is_active: boolean;
}>;

export type FindAllUsersFilter = {
  role?: 'student' | 'staff' | 'admin';
  cohort_id?: number;
};

export class UserRepository {
  static async create(db: DbClient, data: CreateUserInput): Promise<User> {
    return (db as any).user.create({ data });
  }

  static async findById(db: DbClient, id: number): Promise<User | null> {
    return (db as any).user.findUnique({ where: { id, is_active: true } });
  }

  static async findByIdIncludingInactive(db: DbClient, id: number): Promise<User | null> {
    return (db as any).user.findUnique({ where: { id } });
  }

  static async findByEmail(db: DbClient, email: string): Promise<User | null> {
    return (db as any).user.findUnique({ where: { primary_email: email } });
  }

  static async findAll(db: DbClient, filter?: FindAllUsersFilter): Promise<User[]> {
    const where: Record<string, unknown> = { is_active: true };
    if (filter?.role !== undefined) where['role'] = filter.role;
    if (filter?.cohort_id !== undefined) where['cohort_id'] = filter.cohort_id;
    return (db as any).user.findMany({ where, orderBy: { created_at: 'desc' } });
  }

  static async update(db: DbClient, id: number, data: UpdateUserInput): Promise<User> {
    return (db as any).user.update({ where: { id }, data });
  }

  static async delete(db: DbClient, id: number): Promise<User> {
    return (db as any).user.delete({ where: { id } });
  }
}
