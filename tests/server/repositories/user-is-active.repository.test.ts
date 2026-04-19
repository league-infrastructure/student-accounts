/**
 * Tests for is_active filtering in UserRepository.
 *
 * Verifies that:
 *  - findAll() excludes inactive users by default
 *  - findById() returns null for inactive users
 *  - findByIdIncludingInactive() returns inactive users
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { UserRepository } from '../../../server/src/services/repositories/user.repository.js';
import { makeUser } from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
});

// ---------------------------------------------------------------------------
// findAll — excludes inactive users
// ---------------------------------------------------------------------------

describe('UserRepository.findAll — is_active filtering', () => {
  it('excludes inactive users from the default listing', async () => {
    const active = await makeUser({ primary_email: 'active@example.com' });
    const inactive = await makeUser({ primary_email: 'inactive@example.com' });

    // Deactivate one user directly in the DB
    await (prisma as any).user.update({
      where: { id: inactive.id },
      data: { is_active: false },
    });

    const results = await UserRepository.findAll(prisma);
    const ids = results.map((u) => u.id);
    expect(ids).toContain(active.id);
    expect(ids).not.toContain(inactive.id);
  });

  it('includes only active users when filtering by role', async () => {
    const activeStudent = await makeUser({ primary_email: 'stu-active@example.com', role: 'student' });
    const inactiveStudent = await makeUser({ primary_email: 'stu-inactive@example.com', role: 'student' });

    await (prisma as any).user.update({
      where: { id: inactiveStudent.id },
      data: { is_active: false },
    });

    const students = await UserRepository.findAll(prisma, { role: 'student' });
    const ids = students.map((u) => u.id);
    expect(ids).toContain(activeStudent.id);
    expect(ids).not.toContain(inactiveStudent.id);
  });
});

// ---------------------------------------------------------------------------
// findById — returns null for inactive users
// ---------------------------------------------------------------------------

describe('UserRepository.findById — is_active filtering', () => {
  it('returns null when the user is inactive', async () => {
    const user = await makeUser({ primary_email: 'deactivated@example.com' });

    await (prisma as any).user.update({
      where: { id: user.id },
      data: { is_active: false },
    });

    const result = await UserRepository.findById(prisma, user.id);
    expect(result).toBeNull();
  });

  it('returns the user when active', async () => {
    const user = await makeUser({ primary_email: 'stillin@example.com' });
    const result = await UserRepository.findById(prisma, user.id);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(user.id);
  });
});

// ---------------------------------------------------------------------------
// findByIdIncludingInactive — escape hatch for admin views
// ---------------------------------------------------------------------------

describe('UserRepository.findByIdIncludingInactive', () => {
  it('returns an inactive user that findById would miss', async () => {
    const user = await makeUser({ primary_email: 'merged@example.com' });

    await (prisma as any).user.update({
      where: { id: user.id },
      data: { is_active: false },
    });

    // Regular findById must return null
    const byId = await UserRepository.findById(prisma, user.id);
    expect(byId).toBeNull();

    // Admin escape hatch must return the record
    const byIdIncluding = await UserRepository.findByIdIncludingInactive(prisma, user.id);
    expect(byIdIncluding).not.toBeNull();
    expect(byIdIncluding!.id).toBe(user.id);
    expect(byIdIncluding!.is_active).toBe(false);
  });

  it('returns an active user too', async () => {
    const user = await makeUser({ primary_email: 'active2@example.com' });
    const result = await UserRepository.findByIdIncludingInactive(prisma, user.id);
    expect(result).not.toBeNull();
    expect(result!.is_active).toBe(true);
  });

  it('returns null for a non-existent id', async () => {
    const result = await UserRepository.findByIdIncludingInactive(prisma, 999_999_999);
    expect(result).toBeNull();
  });
});
