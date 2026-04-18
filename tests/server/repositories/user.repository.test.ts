/**
 * Integration tests for UserRepository.
 * Uses a real SQLite database — no mocking.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { UserRepository } from '../../../server/src/services/repositories/user.repository.js';
import { makeCohort, makeUser } from '../helpers/factories.js';

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
// create + findById (hit)
// ---------------------------------------------------------------------------

describe('UserRepository.create', () => {
  it('inserts a user and returns the created row', async () => {
    const user = await UserRepository.create(prisma, {
      display_name: 'Alice',
      primary_email: 'alice@example.com',
      role: 'student',
      created_via: 'admin_created',
    });

    expect(user.id).toBeGreaterThan(0);
    expect(user.display_name).toBe('Alice');
    expect(user.primary_email).toBe('alice@example.com');
    expect(user.role).toBe('student');
    expect(user.cohort_id).toBeNull();
    expect(user.created_at).toBeInstanceOf(Date);
  });

  it('creates a user with a cohort_id FK', async () => {
    const cohort = await makeCohort();
    const user = await UserRepository.create(prisma, {
      display_name: 'Bob',
      primary_email: 'bob@example.com',
      created_via: 'admin_created',
      cohort_id: cohort.id,
    });
    expect(user.cohort_id).toBe(cohort.id);
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('UserRepository.findById', () => {
  it('returns the user when found', async () => {
    const created = await makeUser({ display_name: 'Charlie', primary_email: 'charlie@example.com' });
    const found = await UserRepository.findById(prisma, created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.primary_email).toBe('charlie@example.com');
  });

  it('returns null when not found', async () => {
    const result = await UserRepository.findById(prisma, 999_999);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByEmail
// ---------------------------------------------------------------------------

describe('UserRepository.findByEmail', () => {
  it('returns the user matching the email', async () => {
    await makeUser({ primary_email: 'dana@example.com', display_name: 'Dana' });
    const found = await UserRepository.findByEmail(prisma, 'dana@example.com');
    expect(found).not.toBeNull();
    expect(found!.primary_email).toBe('dana@example.com');
  });

  it('returns null when email does not exist', async () => {
    const result = await UserRepository.findByEmail(prisma, 'nobody@example.com');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAll with filters
// ---------------------------------------------------------------------------

describe('UserRepository.findAll', () => {
  it('returns all users when no filter is supplied', async () => {
    await makeUser({ primary_email: 'u1@example.com' });
    await makeUser({ primary_email: 'u2@example.com' });
    const all = await UserRepository.findAll(prisma);
    expect(all.length).toBeGreaterThanOrEqual(2);
  });

  it('filters by role', async () => {
    await makeUser({ primary_email: 'stu@example.com', role: 'student' });
    await makeUser({ primary_email: 'adm@example.com', role: 'admin' });

    const students = await UserRepository.findAll(prisma, { role: 'student' });
    expect(students.every((u) => u.role === 'student')).toBe(true);
  });

  it('filters by cohort_id', async () => {
    const cohort = await makeCohort();
    await makeUser({ primary_email: 'c1@example.com', cohort_id: cohort.id });
    await makeUser({ primary_email: 'c2@example.com' }); // no cohort

    const cohortUsers = await UserRepository.findAll(prisma, { cohort_id: cohort.id });
    expect(cohortUsers.length).toBe(1);
    expect(cohortUsers[0].cohort_id).toBe(cohort.id);
  });
});

// ---------------------------------------------------------------------------
// update
// ---------------------------------------------------------------------------

describe('UserRepository.update', () => {
  it('updates display_name and role', async () => {
    const user = await makeUser({ primary_email: 'upd@example.com', display_name: 'Before' });

    const updated = await UserRepository.update(prisma, user.id, {
      display_name: 'After',
      role: 'staff',
    });

    expect(updated.display_name).toBe('After');
    expect(updated.role).toBe('staff');
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('UserRepository.delete', () => {
  it('deletes the user and a subsequent findById returns null', async () => {
    const user = await makeUser({ primary_email: 'del@example.com' });
    await UserRepository.delete(prisma, user.id);
    const found = await UserRepository.findById(prisma, user.id);
    expect(found).toBeNull();
  });

  it('throws when a Login still references the user (Restrict FK)', async () => {
    const user = await makeUser({ primary_email: 'restricted@example.com' });
    // Create a Login for the user
    await (prisma as any).login.create({
      data: {
        user_id: user.id,
        provider: 'google',
        provider_user_id: 'g_restrict_test',
      },
    });

    // Deleting the user must fail because Login.user_id uses onDelete: Restrict
    await expect(UserRepository.delete(prisma, user.id)).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Unique constraint — duplicate email
// ---------------------------------------------------------------------------

describe('User unique email constraint', () => {
  it('throws when a duplicate primary_email is inserted', async () => {
    await makeUser({ primary_email: 'dup@example.com' });
    await expect(
      UserRepository.create(prisma, {
        display_name: 'Dup',
        primary_email: 'dup@example.com',
        created_via: 'admin_created',
      }),
    ).rejects.toThrow();
  });
});
