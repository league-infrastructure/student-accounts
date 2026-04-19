/**
 * Integration tests for POST /api/admin/users/:id/deprovision (Sprint 005 T009).
 *
 * Covers:
 *  - User with workspace + claude accounts: both removed, 2 succeeded, 0 failed, 200.
 *  - User with only pike13 account: no-op, 0 succeeded, 0 failed, 200.
 *  - One account's API call fails: failed list populated, other account still removed, 207.
 *  - Non-admin caller: 403.
 *  - Unauthenticated: 401.
 *  - User not found: 404.
 *  - Accounts already removed are skipped (only active/suspended are eligible).
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { ServiceRegistry } from '../../../server/src/services/service.registry.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { ExternalAccountLifecycleService } from '../../../server/src/services/external-account-lifecycle.service.js';
import { ExternalAccountRepository } from '../../../server/src/services/repositories/external-account.repository.js';
import { FakeGoogleWorkspaceAdminClient } from '../helpers/fake-google-workspace-admin.client.js';
import { FakeClaudeTeamAdminClient } from '../helpers/fake-claude-team-admin.client.js';
import { makeUser, makeExternalAccount } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
}

/**
 * Inject fake Google + Claude clients into the app's singleton registry
 * so that ExternalAccountLifecycleService uses them instead of the real ones.
 * Returns a restore function.
 */
function injectFakeClients(
  fakeGoogle: FakeGoogleWorkspaceAdminClient,
  fakeClaude: FakeClaudeTeamAdminClient,
): () => void {
  const originalLifecycle = (registry as any).externalAccountLifecycle;

  const newLifecycle = new ExternalAccountLifecycleService(
    fakeGoogle,
    fakeClaude,
    ExternalAccountRepository,
    new AuditService(),
  );

  (registry as any).externalAccountLifecycle = newLifecycle;

  return () => {
    (registry as any).externalAccountLifecycle = originalLifecycle;
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let fakeGoogle: FakeGoogleWorkspaceAdminClient;
let fakeClaude: FakeClaudeTeamAdminClient;
let restore: () => void;

beforeEach(async () => {
  await cleanDb();
  fakeGoogle = new FakeGoogleWorkspaceAdminClient();
  fakeClaude = new FakeClaudeTeamAdminClient();
  restore = injectFakeClients(fakeGoogle, fakeClaude);
});

afterEach(() => {
  restore();
});

afterAll(async () => {
  await cleanDb();
});

// ---------------------------------------------------------------------------
// 401 — unauthenticated
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/deprovision — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const user = await makeUser({ primary_email: 'unauth-target@example.com' });
    const res = await request(app).post(`/api/admin/users/${user.id}/deprovision`);
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 403 — non-admin
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/deprovision — non-admin', () => {
  it('returns 403 for a student caller', async () => {
    await makeUser({ primary_email: 'student-caller@example.com', role: 'student' });
    const target = await makeUser({ primary_email: 'target@example.com' });
    const agent = await loginAs('student-caller@example.com', 'student');
    const res = await agent.post(`/api/admin/users/${target.id}/deprovision`);
    expect(res.status).toBe(403);
  });

  it('returns 403 for a staff caller', async () => {
    await makeUser({ primary_email: 'staff-caller@example.com', role: 'staff' });
    const target = await makeUser({ primary_email: 'target-staff@example.com' });
    const agent = await loginAs('staff-caller@example.com', 'staff');
    const res = await agent.post(`/api/admin/users/${target.id}/deprovision`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 404 — user not found
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/deprovision — 404', () => {
  it('returns 404 when user does not exist', async () => {
    await makeUser({ primary_email: 'admin-404@example.com', role: 'admin' });
    const agent = await loginAs('admin-404@example.com', 'admin');
    const res = await agent.post('/api/admin/users/999999/deprovision');
    expect(res.status).toBe(404);
    expect(res.body.error).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// 200 — user with no eligible accounts (only pike13 or already removed)
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/deprovision — no eligible accounts', () => {
  it('returns 200 with empty lists when user has only a pike13 account', async () => {
    await makeUser({ primary_email: 'admin-noop@example.com', role: 'admin' });
    const student = await makeUser({ primary_email: 'student-pike13@example.com' });
    await makeExternalAccount(student, { type: 'pike13', status: 'active' });

    const agent = await loginAs('admin-noop@example.com', 'admin');
    const res = await agent.post(`/api/admin/users/${student.id}/deprovision`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ succeeded: [], failed: [] });

    // Pike13 account untouched
    const accounts = await (prisma as any).externalAccount.findMany({
      where: { user_id: student.id },
    });
    expect(accounts).toHaveLength(1);
    expect(accounts[0].status).toBe('active');
  });

  it('returns 200 with empty lists when user has no accounts at all', async () => {
    await makeUser({ primary_email: 'admin-noaccounts@example.com', role: 'admin' });
    const student = await makeUser({ primary_email: 'student-noaccounts@example.com' });

    const agent = await loginAs('admin-noaccounts@example.com', 'admin');
    const res = await agent.post(`/api/admin/users/${student.id}/deprovision`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ succeeded: [], failed: [] });
  });

  it('skips already-removed accounts', async () => {
    await makeUser({ primary_email: 'admin-skip-removed@example.com', role: 'admin' });
    const student = await makeUser({ primary_email: 'student-skip-removed@example.com' });
    await makeExternalAccount(student, {
      type: 'workspace',
      status: 'removed',
      external_id: 'old@students.jointheleague.org',
    });

    const agent = await loginAs('admin-skip-removed@example.com', 'admin');
    const res = await agent.post(`/api/admin/users/${student.id}/deprovision`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ succeeded: [], failed: [] });
  });
});

// ---------------------------------------------------------------------------
// 200 — user with workspace + claude accounts: both removed
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/deprovision — success: workspace + claude', () => {
  it('removes both accounts, returns 200 with 2 successes', async () => {
    await makeUser({ primary_email: 'admin-both@example.com', role: 'admin' });
    const student = await makeUser({ primary_email: 'student-both@example.com' });
    const wsAccount = await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: 'student-both@students.jointheleague.org',
    });
    const claudeAccount = await makeExternalAccount(student, {
      type: 'claude',
      status: 'active',
      external_id: 'fake-claude-member-id',
    });

    const agent = await loginAs('admin-both@example.com', 'admin');
    const res = await agent.post(`/api/admin/users/${student.id}/deprovision`);

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toHaveLength(2);
    expect(res.body.succeeded).toContain(wsAccount.id);
    expect(res.body.succeeded).toContain(claudeAccount.id);
    expect(res.body.failed).toHaveLength(0);

    // Both accounts should be removed in DB
    const updated = await (prisma as any).externalAccount.findMany({
      where: { user_id: student.id },
    });
    for (const a of updated) {
      expect(a.status).toBe('removed');
    }

    // Google suspendUser called for workspace account
    expect(fakeGoogle.calls.suspendUser).toContain('student-both@students.jointheleague.org');
    // Claude removeMember called
    expect(fakeClaude.calls.removeMember).toContain('fake-claude-member-id');

    // Audit events: one per account removal + one parent deprovision_student
    const auditEvents = await (prisma as any).auditEvent.findMany({
      where: { target_user_id: student.id },
      orderBy: { created_at: 'asc' },
    });
    const actions = auditEvents.map((e: any) => e.action);
    expect(actions).toContain('remove_workspace');
    expect(actions).toContain('remove_claude');
    expect(actions).toContain('deprovision_student');
  });
});

// ---------------------------------------------------------------------------
// 207 — partial failure: one account fails, other succeeds
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/deprovision — partial failure', () => {
  it('returns 207 when one account fails but the other succeeds', async () => {
    await makeUser({ primary_email: 'admin-partial@example.com', role: 'admin' });
    const student = await makeUser({ primary_email: 'student-partial@example.com' });

    // Claude account — will succeed
    const claudeAccount = await makeExternalAccount(student, {
      type: 'claude',
      status: 'active',
      external_id: 'real-claude-member-id',
    });

    // Workspace account — fakeGoogle will throw on suspendUser
    const wsAccount = await makeExternalAccount(student, {
      type: 'workspace',
      status: 'active',
      external_id: 'ws-fail@students.jointheleague.org',
    });
    fakeGoogle.configureError(
      'suspendUser',
      new Error('Google API unavailable'),
    );

    const agent = await loginAs('admin-partial@example.com', 'admin');
    const res = await agent.post(`/api/admin/users/${student.id}/deprovision`);

    expect(res.status).toBe(207);
    expect(res.body.succeeded).toContain(claudeAccount.id);
    expect(res.body.failed).toHaveLength(1);
    expect(res.body.failed[0].accountId).toBe(wsAccount.id);
    expect(typeof res.body.failed[0].error).toBe('string');

    // Claude account removed
    const claudeRow = await (prisma as any).externalAccount.findUnique({
      where: { id: claudeAccount.id },
    });
    expect(claudeRow.status).toBe('removed');

    // Workspace account still active (failed)
    const wsRow = await (prisma as any).externalAccount.findUnique({
      where: { id: wsAccount.id },
    });
    expect(wsRow.status).toBe('active');
  });
});

// ---------------------------------------------------------------------------
// Suspended accounts are also eligible
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/deprovision — suspended accounts included', () => {
  it('removes a workspace account that is already suspended', async () => {
    await makeUser({ primary_email: 'admin-susp@example.com', role: 'admin' });
    const student = await makeUser({ primary_email: 'student-susp@example.com' });
    const wsAccount = await makeExternalAccount(student, {
      type: 'workspace',
      status: 'suspended',
      external_id: 'suspended@students.jointheleague.org',
    });

    const agent = await loginAs('admin-susp@example.com', 'admin');
    const res = await agent.post(`/api/admin/users/${student.id}/deprovision`);

    expect(res.status).toBe(200);
    expect(res.body.succeeded).toContain(wsAccount.id);
    expect(res.body.failed).toHaveLength(0);

    const updated = await (prisma as any).externalAccount.findUnique({
      where: { id: wsAccount.id },
    });
    expect(updated.status).toBe('removed');

    // Already suspended — suspendUser should NOT be called again
    expect(fakeGoogle.calls.suspendUser).not.toContain('suspended@students.jointheleague.org');
  });
});
