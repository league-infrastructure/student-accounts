/**
 * Test database helper.
 * Uses Prisma client for direct DB access in tests.
 */
import { prisma } from '../../../server/src/services/prisma';

export async function cleanupTestDb() {
  try {
    const testEmailSuffixes = ['@example.com', '@test.com'];

    // Find test users by primary_email
    const testUsers = await prisma.user.findMany({
      where: {
        OR: testEmailSuffixes.map(suffix => ({
          primary_email: { endsWith: suffix },
        })),
      },
      select: { id: true },
    });
    const userIds = testUsers.map((u: any) => u.id);

    if (userIds.length > 0) {
      await prisma.user.deleteMany({
        where: { id: { in: userIds } },
      });
    }
  } catch {
    // Tables may not exist yet
  }
}

export async function findUserByEmail(email: string) {
  return prisma.user.findFirst({ where: { primary_email: email } });
}

export async function findUserById(id: number) {
  return prisma.user.findFirst({ where: { id } });
}
