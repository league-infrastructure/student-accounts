/**
 * Test database helper.
 * Uses Prisma client for direct DB access in tests.
 */
import { prisma } from '../../../server/src/services/prisma';

export async function cleanupTestDb() {
  try {
    const testEmails = ['@example.com', '@test.com'];

    // Find test users
    const testUsers = await prisma.user.findMany({
      where: {
        OR: testEmails.map(suffix => ({
          email: { endsWith: suffix },
        })),
      },
      select: { id: true },
    });
    const userIds = testUsers.map((u: any) => u.id);

    if (userIds.length > 0) {
      // Delete related records first (FK constraints)
      await prisma.userProvider.deleteMany({
        where: { userId: { in: userIds } },
      });
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  } catch {
    // Tables may not exist yet
  }
}

export async function findUserByEmail(email: string) {
  return prisma.user.findFirst({ where: { email } });
}

export async function findUserById(id: number) {
  return prisma.user.findFirst({ where: { id } });
}
