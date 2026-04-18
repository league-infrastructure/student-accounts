import { NotFoundError } from '../errors.js';

export class UserService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  async list() {
    return this.prisma.user.findMany({ orderBy: { createdAt: 'desc' } });
  }

  async getById(id: number) {
    const user = await this.prisma.user.findUnique({ where: { id } });
    if (!user) throw new NotFoundError(`User ${id} not found`);
    return user;
  }

  async getByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  async getByProvider(provider: string, providerId: string) {
    return this.prisma.user.findUnique({
      where: { provider_providerId: { provider, providerId } },
    });
  }

  async upsertByProvider(data: {
    provider: string;
    providerId: string;
    email: string;
    displayName?: string;
    avatarUrl?: string;
  }) {
    return this.prisma.user.upsert({
      where: {
        provider_providerId: { provider: data.provider, providerId: data.providerId },
      },
      update: {
        email: data.email,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl,
      },
      create: {
        provider: data.provider,
        providerId: data.providerId,
        email: data.email,
        displayName: data.displayName,
        avatarUrl: data.avatarUrl,
      },
    });
  }

  async create(data: { email: string; displayName?: string; role?: 'USER' | 'ADMIN' }) {
    return this.prisma.user.create({ data });
  }

  async updateRole(id: number, role: 'USER' | 'ADMIN') {
    return this.prisma.user.update({ where: { id }, data: { role } });
  }

  async update(id: number, data: { email?: string; displayName?: string; role?: 'USER' | 'ADMIN'; avatarUrl?: string }) {
    return this.prisma.user.update({ where: { id }, data });
  }

  async delete(id: number) {
    return this.prisma.user.delete({ where: { id } });
  }

  async count() {
    return this.prisma.user.count();
  }
}
