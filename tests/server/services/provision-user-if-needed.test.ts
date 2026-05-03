/**
 * Unit tests for provisionUserIfNeeded (Sprint 027 T004).
 *
 * Covers:
 *  - User already has an active/pending workspace account → provision not called.
 *  - User has no workspace account → provision called once.
 *  - provision throws → error logged, no exception propagated.
 *
 * Uses a real SQLite test database for ExternalAccount lookups.
 * WorkspaceProvisioningService is a vi.fn() stub to avoid Google API calls.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { provisionUserIfNeeded } from '../../../server/src/services/group.service.js';
import { makeUser, makeExternalAccount } from '../helpers/factories.js';
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ---------------------------------------------------------------------------
// DB cleanup
// ---------------------------------------------------------------------------

async function resetDb() {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

beforeEach(resetDb);

// ---------------------------------------------------------------------------
// Stub
// ---------------------------------------------------------------------------

function makeProvisioningStub(rejects = false) {
  const provision = rejects
    ? vi.fn().mockRejectedValue(new Error('Google API unavailable'))
    : vi.fn().mockResolvedValue({ id: 999, type: 'workspace' });
  return { provision } as any;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('provisionUserIfNeeded', () => {
  it('calls provision when user has no workspace account', async () => {
    const actor = await makeUser({ role: 'admin' });
    const student = await makeUser({ role: 'student' });
    const stub = makeProvisioningStub();

    await provisionUserIfNeeded(prisma, stub, student.id, actor.id);

    expect(stub.provision).toHaveBeenCalledTimes(1);
    expect(stub.provision.mock.calls[0][0]).toBe(student.id);
    expect(stub.provision.mock.calls[0][1]).toBe(actor.id);
  });

  it('does not call provision when user already has an active workspace account', async () => {
    const actor = await makeUser({ role: 'admin' });
    const student = await makeUser({ role: 'student' });
    await makeExternalAccount(student, { type: 'workspace', status: 'active' });
    const stub = makeProvisioningStub();

    await provisionUserIfNeeded(prisma, stub, student.id, actor.id);

    expect(stub.provision).not.toHaveBeenCalled();
  });

  it('does not call provision when user already has a pending workspace account', async () => {
    const actor = await makeUser({ role: 'admin' });
    const student = await makeUser({ role: 'student' });
    await makeExternalAccount(student, { type: 'workspace', status: 'pending' });
    const stub = makeProvisioningStub();

    await provisionUserIfNeeded(prisma, stub, student.id, actor.id);

    expect(stub.provision).not.toHaveBeenCalled();
  });

  it('does not propagate when provision throws (fail-soft)', async () => {
    const actor = await makeUser({ role: 'admin' });
    const student = await makeUser({ role: 'student' });
    const stub = makeProvisioningStub(/* rejects = */ true);

    // Should resolve without throwing.
    await expect(
      provisionUserIfNeeded(prisma, stub, student.id, actor.id),
    ).resolves.toBeUndefined();

    // provision was attempted.
    expect(stub.provision).toHaveBeenCalledTimes(1);
  });

  it('skips provisioning for suspended or removed accounts and calls provision', async () => {
    // A suspended account is not active/pending, so provisioning should fire.
    const actor = await makeUser({ role: 'admin' });
    const student = await makeUser({ role: 'student' });
    await makeExternalAccount(student, { type: 'workspace', status: 'suspended' });
    const stub = makeProvisioningStub();

    await provisionUserIfNeeded(prisma, stub, student.id, actor.id);

    expect(stub.provision).toHaveBeenCalledTimes(1);
  });
});
