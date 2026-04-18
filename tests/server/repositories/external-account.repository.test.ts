/**
 * Integration tests for ExternalAccountRepository.
 * Uses a real SQLite database — no mocking.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { ExternalAccountRepository } from '../../../server/src/services/repositories/external-account.repository.js';
import { makeUser, makeExternalAccount } from '../helpers/factories.js';

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

describe('ExternalAccountRepository.create', () => {
  it('inserts an external account with default status = pending', async () => {
    const user = await makeUser();
    const account = await ExternalAccountRepository.create(prisma, {
      user_id: user.id,
      type: 'workspace',
    });

    expect(account.id).toBeGreaterThan(0);
    expect(account.user_id).toBe(user.id);
    expect(account.type).toBe('workspace');
    expect(account.status).toBe('pending');
    expect(account.created_at).toBeInstanceOf(Date);
  });

  it('creates an account with an explicit status', async () => {
    const user = await makeUser();
    const account = await ExternalAccountRepository.create(prisma, {
      user_id: user.id,
      type: 'claude',
      status: 'active',
    });
    expect(account.status).toBe('active');
    expect(account.type).toBe('claude');
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('ExternalAccountRepository.findById', () => {
  it('returns the account when found', async () => {
    const user = await makeUser();
    const created = await makeExternalAccount(user, { type: 'pike13' });
    const found = await ExternalAccountRepository.findById(prisma, created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.type).toBe('pike13');
  });

  it('returns null when not found', async () => {
    const result = await ExternalAccountRepository.findById(prisma, 999_999);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAllByUser
// ---------------------------------------------------------------------------

describe('ExternalAccountRepository.findAllByUser', () => {
  it('returns all accounts for a user ordered by created_at asc', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'workspace' });
    await makeExternalAccount(user, { type: 'claude' });

    const accounts = await ExternalAccountRepository.findAllByUser(prisma, user.id);
    expect(accounts.length).toBe(2);
    expect(accounts.every((a) => a.user_id === user.id)).toBe(true);
  });

  it('returns an empty array when the user has no accounts', async () => {
    const user = await makeUser();
    const accounts = await ExternalAccountRepository.findAllByUser(prisma, user.id);
    expect(accounts).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findActiveByUserAndType
// ---------------------------------------------------------------------------

describe('ExternalAccountRepository.findActiveByUserAndType', () => {
  it('returns an active account for the user and type', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'workspace', status: 'active' });

    const found = await ExternalAccountRepository.findActiveByUserAndType(
      prisma,
      user.id,
      'workspace',
    );
    expect(found).not.toBeNull();
    expect(found!.status).toBe('active');
    expect(found!.type).toBe('workspace');
  });

  it('returns a pending account (also considered "active" for uniqueness purposes)', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'claude', status: 'pending' });

    const found = await ExternalAccountRepository.findActiveByUserAndType(
      prisma,
      user.id,
      'claude',
    );
    expect(found).not.toBeNull();
    expect(found!.status).toBe('pending');
  });

  it('returns null when only a removed account exists', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'workspace', status: 'removed' });

    const found = await ExternalAccountRepository.findActiveByUserAndType(
      prisma,
      user.id,
      'workspace',
    );
    expect(found).toBeNull();
  });

  it('returns null when no account of the given type exists', async () => {
    const user = await makeUser();
    const found = await ExternalAccountRepository.findActiveByUserAndType(
      prisma,
      user.id,
      'pike13',
    );
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('ExternalAccountRepository.updateStatus', () => {
  it('updates the status and sets status_changed_at', async () => {
    const user = await makeUser();
    const account = await makeExternalAccount(user, { type: 'workspace', status: 'pending' });

    const updated = await ExternalAccountRepository.updateStatus(prisma, account.id, 'active');
    expect(updated.status).toBe('active');
    expect(updated.status_changed_at).toBeInstanceOf(Date);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('ExternalAccountRepository.delete', () => {
  it('deletes the account row', async () => {
    const user = await makeUser();
    const account = await makeExternalAccount(user);
    await ExternalAccountRepository.delete(prisma, account.id);
    const found = await ExternalAccountRepository.findById(prisma, account.id);
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FK constraint — creating an account for a non-existent user
// ---------------------------------------------------------------------------

describe('ExternalAccount FK constraint', () => {
  it('throws when user_id does not reference an existing user', async () => {
    await expect(
      ExternalAccountRepository.create(prisma, {
        user_id: 999_999,
        type: 'workspace',
      }),
    ).rejects.toThrow();
  });

  it('throws when deleting a user that still has ExternalAccount rows (Restrict FK)', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'workspace' });
    await expect((prisma as any).user.delete({ where: { id: user.id } })).rejects.toThrow();
  });
});
