/**
 * Integration tests for ExternalAccountLifecycleService (Sprint 005, T005).
 *
 * Covers:
 *  - suspend workspace: suspendUser called, status=suspended, audit event.
 *  - suspend claude: suspendMember called (OQ-003 no-op), status=suspended, audit event.
 *  - suspend already-suspended: succeeds (idempotent — only blocked for removed).
 *  - suspend already-removed: UnprocessableError.
 *  - suspend non-existent account: NotFoundError.
 *  - remove workspace (active): suspendUser called, scheduled_delete_at set, status=removed.
 *  - remove workspace (already-suspended): suspendUser NOT called, status=removed.
 *  - remove claude: removeMember called, status=removed, audit event.
 *  - remove already-removed: UnprocessableError.
 *  - remove non-existent account: NotFoundError.
 *  - WORKSPACE_DELETE_DELAY_DAYS controls the scheduled_delete_at offset.
 */

import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { ExternalAccountLifecycleService } from '../../../server/src/services/external-account-lifecycle.service.js';
import { ExternalAccountRepository } from '../../../server/src/services/repositories/external-account.repository.js';
import { NotFoundError, UnprocessableError } from '../../../server/src/errors.js';
import { FakeGoogleWorkspaceAdminClient } from '../helpers/fake-google-workspace-admin.client.js';
import { FakeClaudeTeamAdminClient } from '../helpers/fake-claude-team-admin.client.js';
import { makeUser, makeExternalAccount } from '../helpers/factories.js';
import type { Prisma } from '../../../server/src/generated/prisma/client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearDb() {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

function makeService(
  fakeGoogle: FakeGoogleWorkspaceAdminClient,
  fakeClaude: FakeClaudeTeamAdminClient,
): ExternalAccountLifecycleService {
  return new ExternalAccountLifecycleService(
    fakeGoogle,
    fakeClaude,
    ExternalAccountRepository,
    new AuditService(),
  );
}

async function runInTransaction<T>(
  fn: (tx: Prisma.TransactionClient) => Promise<T>,
): Promise<T> {
  return (prisma as any).$transaction(fn);
}

// ---------------------------------------------------------------------------
// Test setup
// ---------------------------------------------------------------------------

let fakeGoogle: FakeGoogleWorkspaceAdminClient;
let fakeClaude: FakeClaudeTeamAdminClient;
let originalDelay: string | undefined;

beforeEach(async () => {
  await clearDb();
  fakeGoogle = new FakeGoogleWorkspaceAdminClient();
  fakeClaude = new FakeClaudeTeamAdminClient();
  originalDelay = process.env.WORKSPACE_DELETE_DELAY_DAYS;
  // Ensure a known default for delay tests unless overridden per-test
  process.env.WORKSPACE_DELETE_DELAY_DAYS = '3';
});

afterEach(() => {
  if (originalDelay !== undefined) {
    process.env.WORKSPACE_DELETE_DELAY_DAYS = originalDelay;
  } else {
    delete process.env.WORKSPACE_DELETE_DELAY_DAYS;
  }
});

// ---------------------------------------------------------------------------
// suspend — workspace
// ---------------------------------------------------------------------------

describe('ExternalAccountLifecycleService.suspend — workspace', () => {
  it('calls suspendUser with the account external_id', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.suspend(account.id, admin.id, tx));

    expect(fakeGoogle.calls.suspendUser).toHaveLength(1);
    expect(fakeGoogle.calls.suspendUser[0]).toBe('alice@students.jointheleague.org');
  });

  it('sets status=suspended and status_changed_at', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });

    const before = new Date();
    const svc = makeService(fakeGoogle, fakeClaude);
    const updated = await runInTransaction((tx) => svc.suspend(account.id, admin.id, tx));
    const after = new Date();

    expect(updated.status).toBe('suspended');
    expect(updated.status_changed_at).not.toBeNull();
    expect(updated.status_changed_at!.getTime()).toBeGreaterThanOrEqual(before.getTime());
    expect(updated.status_changed_at!.getTime()).toBeLessThanOrEqual(after.getTime());
  });

  it('records a suspend_workspace audit event', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.suspend(account.id, admin.id, tx));

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'suspend_workspace', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_entity_type).toBe('ExternalAccount');
    expect(events[0].target_entity_id).toBe(String(account.id));
  });

  it('does not call suspendMember for a workspace account', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.suspend(account.id, admin.id, tx));

    expect(fakeClaude.calls.suspendMember).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// suspend — claude
// ---------------------------------------------------------------------------

describe('ExternalAccountLifecycleService.suspend — claude', () => {
  it('does not call any Anthropic Admin API for claude suspend (status-only change)', async () => {
    // AnthropicAdminClient has no suspend operation. Claude account suspend is
    // a status-only change in our database; the org member remains active in
    // the Anthropic API until explicitly removed via deleteOrgUser.
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'claude-member-abc',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.suspend(account.id, admin.id, tx));

    expect(fakeClaude.calls.suspendMember).toHaveLength(0);
    expect(fakeClaude.calls.deleteOrgUser).toHaveLength(0);
  });

  it('sets status=suspended', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'claude-member-abc',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    const updated = await runInTransaction((tx) => svc.suspend(account.id, admin.id, tx));

    expect(updated.status).toBe('suspended');
  });

  it('records a suspend_claude audit event', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'claude-member-abc',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.suspend(account.id, admin.id, tx));

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'suspend_claude', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_entity_type).toBe('ExternalAccount');
    expect(events[0].target_entity_id).toBe(String(account.id));
  });

  it('does not call suspendUser for a claude account', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'claude-member-abc',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.suspend(account.id, admin.id, tx));

    expect(fakeGoogle.calls.suspendUser).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// suspend — error cases
// ---------------------------------------------------------------------------

describe('ExternalAccountLifecycleService.suspend — error cases', () => {
  it('throws NotFoundError when accountId does not exist', async () => {
    const admin = await makeUser({ role: 'admin' });
    const svc = makeService(fakeGoogle, fakeClaude);

    await expect(
      runInTransaction((tx) => svc.suspend(999999, admin.id, tx)),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws UnprocessableError when account is already removed', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'removed',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await expect(
      runInTransaction((tx) => svc.suspend(account.id, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeGoogle.calls.suspendUser).toHaveLength(0);
  });

  it('allows suspending an already-suspended account', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'suspended',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    // Should not throw
    const updated = await runInTransaction((tx) => svc.suspend(account.id, admin.id, tx));
    expect(updated.status).toBe('suspended');
  });
});

// ---------------------------------------------------------------------------
// remove — workspace
// ---------------------------------------------------------------------------

describe('ExternalAccountLifecycleService.remove — workspace (active)', () => {
  it('calls suspendUser before removal when account is active', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));

    expect(fakeGoogle.calls.suspendUser).toHaveLength(1);
    expect(fakeGoogle.calls.suspendUser[0]).toBe('alice@students.jointheleague.org');
  });

  it('sets status=removed immediately', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    const updated = await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));

    expect(updated.status).toBe('removed');
    expect(updated.status_changed_at).not.toBeNull();
  });

  it('sets scheduled_delete_at to now + WORKSPACE_DELETE_DELAY_DAYS', async () => {
    process.env.WORKSPACE_DELETE_DELAY_DAYS = '3';
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });

    const before = new Date();
    const svc = makeService(fakeGoogle, fakeClaude);
    const updated = await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));
    const after = new Date();

    expect(updated.scheduled_delete_at).not.toBeNull();
    const delayMs = 3 * 86400000;
    expect(updated.scheduled_delete_at!.getTime()).toBeGreaterThanOrEqual(before.getTime() + delayMs);
    expect(updated.scheduled_delete_at!.getTime()).toBeLessThanOrEqual(after.getTime() + delayMs);
  });

  it('WORKSPACE_DELETE_DELAY_DAYS env var controls the delay', async () => {
    process.env.WORKSPACE_DELETE_DELAY_DAYS = '7';
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });

    const before = new Date();
    const svc = makeService(fakeGoogle, fakeClaude);
    const updated = await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));
    const after = new Date();

    expect(updated.scheduled_delete_at).not.toBeNull();
    const delayMs = 7 * 86400000;
    expect(updated.scheduled_delete_at!.getTime()).toBeGreaterThanOrEqual(before.getTime() + delayMs);
    expect(updated.scheduled_delete_at!.getTime()).toBeLessThanOrEqual(after.getTime() + delayMs);
  });

  it('records a remove_workspace audit event', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'active',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'remove_workspace', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_entity_type).toBe('ExternalAccount');
    expect(events[0].target_entity_id).toBe(String(account.id));
  });
});

describe('ExternalAccountLifecycleService.remove — workspace (already-suspended)', () => {
  it('does NOT call suspendUser when account is already suspended', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'suspended',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));

    expect(fakeGoogle.calls.suspendUser).toHaveLength(0);
  });

  it('still sets status=removed and scheduled_delete_at', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'suspended',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    const updated = await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));

    expect(updated.status).toBe('removed');
    expect(updated.scheduled_delete_at).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// remove — claude
// ---------------------------------------------------------------------------

describe('ExternalAccountLifecycleService.remove — claude', () => {
  it('calls removeMember with the account external_id', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'claude-member-xyz',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));

    expect(fakeClaude.calls.removeMember).toHaveLength(1);
    expect(fakeClaude.calls.removeMember[0]).toBe('claude-member-xyz');
  });

  it('sets status=removed', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'claude-member-xyz',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    const updated = await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));

    expect(updated.status).toBe('removed');
    expect(updated.status_changed_at).not.toBeNull();
  });

  it('does not set scheduled_delete_at for claude accounts', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'claude-member-xyz',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    const updated = await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));

    expect(updated.scheduled_delete_at).toBeNull();
  });

  it('records a remove_claude audit event', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'claude-member-xyz',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'remove_claude', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(admin.id);
    expect(events[0].target_entity_type).toBe('ExternalAccount');
    expect(events[0].target_entity_id).toBe(String(account.id));
  });

  it('does not call suspendUser for claude accounts', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'claude',
      status: 'active',
      external_id: 'claude-member-xyz',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await runInTransaction((tx) => svc.remove(account.id, admin.id, tx));

    expect(fakeGoogle.calls.suspendUser).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// remove — error cases
// ---------------------------------------------------------------------------

describe('ExternalAccountLifecycleService.remove — error cases', () => {
  it('throws NotFoundError when accountId does not exist', async () => {
    const admin = await makeUser({ role: 'admin' });
    const svc = makeService(fakeGoogle, fakeClaude);

    await expect(
      runInTransaction((tx) => svc.remove(999999, admin.id, tx)),
    ).rejects.toThrow(NotFoundError);
  });

  it('throws UnprocessableError when account is already removed', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'workspace',
      status: 'removed',
      external_id: 'alice@students.jointheleague.org',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await expect(
      runInTransaction((tx) => svc.remove(account.id, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeGoogle.calls.suspendUser).toHaveLength(0);
  });

  it('throws UnprocessableError for already-removed claude account', async () => {
    const user = await makeUser();
    const admin = await makeUser({ role: 'admin' });
    const account = await makeExternalAccount(user, {
      type: 'claude',
      status: 'removed',
      external_id: 'claude-member-xyz',
    });

    const svc = makeService(fakeGoogle, fakeClaude);
    await expect(
      runInTransaction((tx) => svc.remove(account.id, admin.id, tx)),
    ).rejects.toThrow(UnprocessableError);

    expect(fakeClaude.calls.removeMember).toHaveLength(0);
  });
});
