/**
 * Integration tests for ProvisioningRequestRepository.
 * Uses a real SQLite database — no mocking.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { ProvisioningRequestRepository } from '../../../server/src/services/repositories/provisioning-request.repository.js';
import { makeUser, makeProvisioningRequest } from '../helpers/factories.js';

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

describe('ProvisioningRequestRepository.create', () => {
  it('inserts a pending workspace request', async () => {
    const user = await makeUser();
    const req = await ProvisioningRequestRepository.create(prisma, {
      user_id: user.id,
      requested_type: 'workspace',
    });

    expect(req.id).toBeGreaterThan(0);
    expect(req.user_id).toBe(user.id);
    expect(req.requested_type).toBe('workspace');
    expect(req.status).toBe('pending');
    expect(req.decided_by).toBeNull();
    expect(req.decided_at).toBeNull();
    expect(req.created_at).toBeInstanceOf(Date);
  });

  it('creates a claude request with explicit status', async () => {
    const user = await makeUser();
    const req = await ProvisioningRequestRepository.create(prisma, {
      user_id: user.id,
      requested_type: 'claude',
      status: 'approved',
    });
    expect(req.requested_type).toBe('claude');
    expect(req.status).toBe('approved');
  });
});

// ---------------------------------------------------------------------------
// findById
// ---------------------------------------------------------------------------

describe('ProvisioningRequestRepository.findById', () => {
  it('returns the request when found', async () => {
    const user = await makeUser();
    const created = await makeProvisioningRequest(user, { requested_type: 'workspace' });
    const found = await ProvisioningRequestRepository.findById(prisma, created.id);
    expect(found).not.toBeNull();
    expect(found!.id).toBe(created.id);
    expect(found!.requested_type).toBe('workspace');
  });

  it('returns null when not found', async () => {
    const result = await ProvisioningRequestRepository.findById(prisma, 999_999);
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findByUser
// ---------------------------------------------------------------------------

describe('ProvisioningRequestRepository.findByUser', () => {
  it('returns all requests for a user, newest first', async () => {
    const user = await makeUser();
    const other = await makeUser();

    await makeProvisioningRequest(user, { requested_type: 'workspace' });
    await makeProvisioningRequest(user, { requested_type: 'claude' });
    await makeProvisioningRequest(other, { requested_type: 'workspace' });

    const requests = await ProvisioningRequestRepository.findByUser(prisma, user.id);
    expect(requests.length).toBe(2);
    expect(requests.every((r) => r.user_id === user.id)).toBe(true);
  });

  it('returns an empty array when the user has no requests', async () => {
    const user = await makeUser();
    const requests = await ProvisioningRequestRepository.findByUser(prisma, user.id);
    expect(requests).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// findPending
// ---------------------------------------------------------------------------

describe('ProvisioningRequestRepository.findPending', () => {
  it('returns only pending requests in FIFO order', async () => {
    const user = await makeUser();
    const r1 = await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'pending' });
    const r2 = await makeProvisioningRequest(user, { requested_type: 'claude', status: 'pending' });
    await makeProvisioningRequest(user, { requested_type: 'workspace', status: 'approved' });

    const pending = await ProvisioningRequestRepository.findPending(prisma);
    expect(pending.length).toBe(2);
    expect(pending.every((r) => r.status === 'pending')).toBe(true);
    // FIFO — oldest first
    expect(pending[0].id).toBe(r1.id);
    expect(pending[1].id).toBe(r2.id);
  });
});

// ---------------------------------------------------------------------------
// updateStatus
// ---------------------------------------------------------------------------

describe('ProvisioningRequestRepository.updateStatus', () => {
  it('updates status to approved with decided_by and decided_at', async () => {
    const user = await makeUser();
    const admin = await makeUser();
    const req = await makeProvisioningRequest(user);
    const decidedAt = new Date();

    const updated = await ProvisioningRequestRepository.updateStatus(
      prisma,
      req.id,
      'approved',
      admin.id,
      decidedAt,
    );

    expect(updated.status).toBe('approved');
    expect(updated.decided_by).toBe(admin.id);
    expect(updated.decided_at).not.toBeNull();
  });

  it('updates status to rejected with null decided_by', async () => {
    const user = await makeUser();
    const req = await makeProvisioningRequest(user);

    const updated = await ProvisioningRequestRepository.updateStatus(
      prisma,
      req.id,
      'rejected',
    );

    expect(updated.status).toBe('rejected');
    expect(updated.decided_by).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// FK constraint — Cascade delete
// ---------------------------------------------------------------------------

describe('ProvisioningRequest FK cascade', () => {
  it('deletes requests when the requesting user is deleted', async () => {
    const user = await makeUser();
    const req = await makeProvisioningRequest(user);

    await (prisma as any).user.delete({ where: { id: user.id } });

    const found = await ProvisioningRequestRepository.findById(prisma, req.id);
    expect(found).toBeNull();
  });

  it('throws when user_id does not reference an existing user', async () => {
    await expect(
      ProvisioningRequestRepository.create(prisma, {
        user_id: 999_999,
        requested_type: 'workspace',
      }),
    ).rejects.toThrow();
  });
});
