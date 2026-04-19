/**
 * CohortRepository — typed CRUD for the Cohort entity.
 *
 * All methods accept a DbClient as their first argument so they can be
 * composed inside a service-owned transaction without holding state.
 *
 * FK errors (e.g., deleting a cohort that still has users) propagate as
 * Prisma errors; callers may catch and re-wrap as ConflictError if desired.
 */
import type { Cohort } from '../../generated/prisma/client.js';
import type { DbClient } from './types.js';

export type CreateCohortInput = {
  name: string;
  google_ou_path?: string | null;
};

export type UpdateCohortInput = Partial<{
  name: string;
  google_ou_path: string | null;
}>;

export class CohortRepository {
  static async create(db: DbClient, data: CreateCohortInput): Promise<Cohort> {
    return (db as any).cohort.create({ data });
  }

  static async findById(db: DbClient, id: number): Promise<Cohort | null> {
    return (db as any).cohort.findUnique({ where: { id } });
  }

  static async findByName(db: DbClient, name: string): Promise<Cohort | null> {
    return (db as any).cohort.findUnique({ where: { name } });
  }

  static async findByOUPath(db: DbClient, google_ou_path: string): Promise<Cohort | null> {
    return (db as any).cohort.findFirst({ where: { google_ou_path } });
  }

  /** Return all cohorts that have a non-null google_ou_path. */
  static async findAllWithOUPath(db: DbClient): Promise<Cohort[]> {
    return (db as any).cohort.findMany({
      where: { google_ou_path: { not: null } },
      orderBy: { name: 'asc' },
    });
  }

  static async findAll(db: DbClient): Promise<Cohort[]> {
    return (db as any).cohort.findMany({ orderBy: { name: 'asc' } });
  }

  static async update(db: DbClient, id: number, data: UpdateCohortInput): Promise<Cohort> {
    return (db as any).cohort.update({ where: { id }, data });
  }

  static async delete(db: DbClient, id: number): Promise<Cohort> {
    return (db as any).cohort.delete({ where: { id } });
  }
}
