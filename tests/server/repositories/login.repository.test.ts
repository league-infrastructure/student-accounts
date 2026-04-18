/**
 * Integration tests for LoginRepository.
 * Uses a real SQLite database — no mocking.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { LoginRepository } from '../../../server/src/services/repositories/login.repository.js';
import { makeUser, makeLogin } from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeEach(async () => {
  // Delete in FK-safe order across all domain tables.
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
});

// ---------------------------------------------------------------------------
// create + findById (hit)
// ---------------------------------------------------------------------------

describe('LoginRepository.create', () => {
  it('inserts a login and returns the created row', async () => {
    const user = await makeUser();
    const login = await LoginRepository.create(prisma, {
      user_id: user.id,
      provider: 'google',
      provider_user_id: 'google_abc123',
      provider_email: 'alice@gmail.com',
    });

    expect(login.id).toBeGreaterThan(0);
    expect(login.user_id).toBe(user.id);
    expect(login.provider).toBe('google');
    expect(login.provider_user_id).toBe('google_abc123');
    expect(login.provider_email).toBe('alice@gmail.com');
    expect(login.created_at).toBeInstanceOf(Date);
  });

  it('creates a login with a null provider_email', async () => {
    const user = await makeUser();
    const login = await LoginRepository.create(prisma, {
      user_id: user.id,
      provider: 'github',
      provider_user_id: 'gh_noemail',
      provider_email: null,
    });
    expect(login.provider_email).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('LoginRepository.findById', () => {
  it('returns the login when found', async () => {
    const user = await makeUser();
    const created = await makeLogin(user, { provider: 'google', provider_user_id: 'find_me' });
    const found = await LoginRepository.findById(prisma, created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
  });

  it('returns null when not found', async () => {
    const result = await LoginRepository.findById(prisma, 999_999);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByProvider
// ---------------------------------------------------------------------------

describe('LoginRepository.findByProvider', () => {
  it('returns the login matching the provider + provider_user_id', async () => {
    const user = await makeUser();
    await makeLogin(user, { provider: 'github', provider_user_id: 'gh_99' });

    const found = await LoginRepository.findByProvider(prisma, 'github', 'gh_99');
    expect(found).not.toBeNull();
    expect(found!.user_id).toBe(user.id);
    expect(found!.provider).toBe('github');
  });

  it('returns null when provider pair does not exist', async () => {
    const result = await LoginRepository.findByProvider(prisma, 'google', 'nonexistent_uid');
    expect(result).toBeNull();
  });

  it('does not match on provider alone (wrong provider_user_id)', async () => {
    const user = await makeUser();
    await makeLogin(user, { provider: 'google', provider_user_id: 'correct_uid' });

    const result = await LoginRepository.findByProvider(prisma, 'google', 'wrong_uid');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAllByUser
// ---------------------------------------------------------------------------

describe('LoginRepository.findAllByUser', () => {
  it('returns all logins for a user', async () => {
    const user = await makeUser();
    await makeLogin(user, { provider: 'google', provider_user_id: 'g1' });
    await makeLogin(user, { provider: 'github', provider_user_id: 'gh1' });

    const logins = await LoginRepository.findAllByUser(prisma, user.id);
    expect(logins.length).toBe(2);
    expect(logins.every((l) => l.user_id === user.id)).toBe(true);
  });

  it('returns an empty array when the user has no logins', async () => {
    const user = await makeUser();
    const logins = await LoginRepository.findAllByUser(prisma, user.id);
    expect(logins).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('LoginRepository.delete', () => {
  it('deletes the login row', async () => {
    const user = await makeUser();
    const login = await makeLogin(user);
    await LoginRepository.delete(prisma, login.id);
    const found = await LoginRepository.findById(prisma, login.id);
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FK constraint — creating a login for a non-existent user
// ---------------------------------------------------------------------------

describe('Login FK constraint', () => {
  it('throws when user_id does not reference an existing user', async () => {
    await expect(
      LoginRepository.create(prisma, {
        user_id: 999_999,
        provider: 'google',
        provider_user_id: 'orphan_uid',
      }),
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// Unique constraint — (provider, provider_user_id)
// ---------------------------------------------------------------------------

describe('Login unique (provider, provider_user_id) constraint', () => {
  it('throws when the same provider+provider_user_id is inserted twice', async () => {
    const user = await makeUser();
    await makeLogin(user, { provider: 'google', provider_user_id: 'dup_uid' });
    await expect(
      LoginRepository.create(prisma, {
        user_id: user.id,
        provider: 'google',
        provider_user_id: 'dup_uid',
      }),
    ).rejects.toThrow();
  });
});
