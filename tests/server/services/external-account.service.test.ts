/**
 * Integration tests for ExternalAccountService.
 *
 * Covers:
 *  - create: creates ExternalAccount in pending status
 *  - create: throws ConflictError when active/pending account of same type exists
 *  - findAllByUser: returns all accounts for a user
 *  - findActiveByUserAndType: returns active/pending account or null
 *  - updateStatus: updates status + records correct audit action
 *    - suspended + workspace → suspend_workspace
 *    - suspended + claude   → suspend_claude
 *    - removed  + workspace → remove_workspace
 *    - removed  + claude    → remove_claude
 *  - updateStatus: throws NotFoundError for unknown account
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { ExternalAccountService } from '../../../server/src/services/external-account.service.js';
import { ConflictError, NotFoundError } from '../../../server/src/errors.js';
import { makeUser, makeExternalAccount } from '../helpers/factories.js';

let svc: ExternalAccountService;

beforeEach(async () => {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();

  svc = new ExternalAccountService(prisma, new AuditService());
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('ExternalAccountService.create', () => {
  it('creates an ExternalAccount in pending status', async () => {
    const user = await makeUser();
    const acct = await svc.create(user.id, 'workspace');

    expect(acct.id).toBeDefined();
    expect(acct.user_id).toBe(user.id);
    expect(acct.type).toBe('workspace');
    expect(acct.status).toBe('pending');
  });

  it('stores externalId when provided', async () => {
    const user = await makeUser();
    const acct = await svc.create(user.id, 'claude', 'claude-ext-123');
    expect(acct.external_id).toBe('claude-ext-123');
  });

  it('throws ConflictError when an active account of the same type already exists', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'workspace', status: 'active' });

    await expect(svc.create(user.id, 'workspace')).rejects.toThrow(ConflictError);
  });

  it('throws ConflictError when a pending account of the same type already exists', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'claude', status: 'pending' });

    await expect(svc.create(user.id, 'claude')).rejects.toThrow(ConflictError);
  });

  it('allows creating an account when only removed accounts of that type exist', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'workspace', status: 'removed' });

    // Should not throw — removed is not active/pending
    const acct = await svc.create(user.id, 'workspace');
    expect(acct.status).toBe('pending');
  });
});

// ---------------------------------------------------------------------------
// findAllByUser
// ---------------------------------------------------------------------------

describe('ExternalAccountService.findAllByUser', () => {
  it('returns all accounts for a user', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'workspace' });
    await makeExternalAccount(user, { type: 'claude', status: 'removed' });

    const accounts = await svc.findAllByUser(user.id);
    expect(accounts).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// findActiveByUserAndType
// ---------------------------------------------------------------------------

describe('ExternalAccountService.findActiveByUserAndType', () => {
  it('returns the active account', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'workspace', status: 'active' });

    const found = await svc.findActiveByUserAndType(user.id, 'workspace');
    expect(found).not.toBeNull();
    expect(found!.status).toBe('active');
  });

  it('returns null when no active/pending account exists', async () => {
    const user = await makeUser();
    await makeExternalAccount(user, { type: 'workspace', status: 'removed' });

    const found = await svc.findActiveByUserAndType(user.id, 'workspace');
    expect(found).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// updateStatus — audit action mapping
// ---------------------------------------------------------------------------

describe('ExternalAccountService.updateStatus', () => {
  it('throws NotFoundError for a non-existent account', async () => {
    await expect(svc.updateStatus(9999999, 'suspended')).rejects.toThrow(NotFoundError);
  });

  it.each([
    ['workspace', 'suspended', 'suspend_workspace'],
    ['workspace', 'removed',   'remove_workspace'],
    ['claude',    'suspended', 'suspend_claude'],
    ['claude',    'removed',   'remove_claude'],
  ] as const)(
    'records action %s for type=%s, status=%s',
    async (type, status, expectedAction) => {
      const user = await makeUser();
      const acct = await makeExternalAccount(user, { type, status: 'active' });

      await svc.updateStatus(acct.id, status, null);

      const events = await (prisma as any).auditEvent.findMany({
        where: { action: expectedAction, target_entity_id: String(acct.id) },
      });
      expect(events).toHaveLength(1);
      expect(events[0].target_entity_type).toBe('ExternalAccount');
    },
  );

  it('updates the account status', async () => {
    const user = await makeUser();
    const acct = await makeExternalAccount(user, { type: 'workspace', status: 'active' });

    const updated = await svc.updateStatus(acct.id, 'suspended', null);
    expect(updated.status).toBe('suspended');
    expect(updated.status_changed_at).toBeDefined();
  });
});
