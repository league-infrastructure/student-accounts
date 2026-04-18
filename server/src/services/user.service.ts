// NOTE: This is a minimal stub updated for the domain User schema (T003).
// The full rewrite aligning with the repository pattern is T008.
import { NotFoundError } from '../errors.js';

export class UserService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  async list() {
    return this.prisma.user.findMany({ orderBy: { created_at: 'desc' } });
  }

  async getById(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError(`User ${id} not found`);
    return user;
  }

  async getByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { primary_email: email } });
  }

  async create(data: { email?: string; displayName?: string; role?: string }) {
    return this.prisma.user.create({
      data: {
        primary_email: data.email ?? 'unknown@example.com',
        display_name: data.displayName ?? data.email ?? 'Unknown',
        role: mapRole(data.role),
        created_via: 'admin_created',
      },
    });
  }

  async update(id: number, data: { email?: string; displayName?: string; role?: string }) {
    return this.prisma.user.update({
      where: { id },
      data: {
        ...(data.email !== undefined ? { primary_email: data.email } : {}),
        ...(data.displayName !== undefined ? { display_name: data.displayName } : {}),
        ...(data.role !== undefined ? { role: mapRole(data.role) } : {}),
      },
    });
  }

  async updateRole(id: number, role: string) {
    return this.prisma.user.update({ where: { id }, data: { role: mapRole(role) } });
  }

  async delete(id: number) {
    return this.prisma.user.delete({ where: { id } });
  }

  async count() {
    return this.prisma.user.count();
  }
}

/** Map legacy USER/ADMIN role strings to domain enum values. */
function mapRole(role: string | undefined): string {
  if (role === 'ADMIN') return 'admin';
  if (role === 'USER') return 'student';
  // Accept domain enum values directly
  if (role === 'admin' || role === 'staff' || role === 'student') return role;
  return 'student';
}
