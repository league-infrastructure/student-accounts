/**
 * Integration tests for admin external-accounts routes (Sprint 005 T008).
 *
 * Covers:
 *  - POST /api/admin/external-accounts/:id/suspend:
 *      403 (non-admin), 200 (success, status updated), 422 (already suspended)
 *  - POST /api/admin/external-accounts/:id/remove:
 *      403 (non-admin), 200 (success, scheduled_delete_at set), 422 (already removed)
 *  - POST /api/admin/users/:id/provision-claude:
 *      403 (non-admin), 201 (success, ExternalAccount created), 422 (no workspace
 *      account), 409 (already has claude)
 *
 * Strategy for routes that call external APIs:
 *  - For workspace suspend/remove: uses a 'claude' ExternalAccount so the
 *    ExternalAccountLifecycleService does not call the real Google client.
 *  - For provision-claude: injects a FakeClaudeTeamAdminClient into the
 *    singleton app registry.
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { FakeClaudeTeamAdminClient } from '../../helpers/fake-claude-team-admin.client.js';
import { FakeGoogleWorkspaceAdminClient } from '../../helpers/fake-google-workspace-admin.client.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { ClaudeProvisioningService } from '../../../../server/src/services/claude-provisioning.service.js';
import { ExternalAccountLifecycleService } from '../../../../server/src/services/external-account-lifecycle.service.js';
import { ExternalAccountRepository } from '../../../../server/src/services/repositories/external-account.repository.js';
import { UserRepository } from '../../../../server/src/services/repositories/user.repository.js';
import { makeUser, makeExternalAccount } from '../../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

/**
 * Create a supertest agent with an active session for the given email/role.
 */
async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
}

/**
 * Inject a FakeClaudeTeamAdminClient into the app's singleton registry,
 * replacing the claudeProvisioning and externalAccountLifecycle services.
 * Returns a cleanup function that restores the originals.
 */
function injectFakeClaudeClient(
  fakeGoogle: FakeGoogleWorkspaceAdminClient,
  fakeClaude: FakeClaudeTeamAdminClient,
): () => void {
  const originalClaudeProvisioning = (registry as any).claudeProvisioning;
  const originalExternalAccountLifecycle = (registry as any).externalAccountLifecycle;

  const audit = new AuditService();
  const newClaudeProvisioning = new ClaudeProvisioningService(
    fakeClaude,
    ExternalAccountRepository,
    audit,
    UserRepository,
  );
  const newExternalAccountLifecycle = new ExternalAccountLifecycleService(
    fakeGoogle,
    fakeClaude,
    ExternalAccountRepository,
    audit,
  );

  (registry as any).claudeProvisioning = newClaudeProvisioning;
  (registry as any).externalAccountLifecycle = newExternalAccountLifecycle;

  return () => {
    (registry as any).claudeProvisioning = originalClaudeProvisioning;
    (registry as any).externalAccountLifecycle = originalExternalAccountLifecycle;
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
});

// ===========================================================================
// POST /api/admin/external-accounts/:id/suspend
// ===========================================================================

// ---------------------------------------------------------------------------
// 403 — non-admin
// ---------------------------------------------------------------------------

describe('POST /api/admin/external-accounts/:id/suspend — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-suspend@example.com', role: 'student' });
    const agent = await loginAs('student-suspend@example.com', 'student');
    const res = await agent.post('/api/admin/external-accounts/1/suspend');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 200 — success (claude account, avoids Google API call)
// ---------------------------------------------------------------------------

describe('POST /api/admin/external-accounts/:id/suspend — success', () => {
  it('returns 200 with updated account when suspending a claude account', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const fakeClaude = new FakeClaudeTeamAdminClient();
    // Provide a Students workspace for the suspend call (removeUserFromWorkspace)
    fakeClaude.configure('listWorkspaces', [{ id: 'ws-students-test', name: 'Students' }]);
    const restore = injectFakeClaudeClient(fakeGoogle, fakeClaude);

    try {
      await makeUser({ primary_email: 'admin-suspend@example.com', role: 'admin' });
      const student = await makeUser({ primary_email: 'student-s1@example.com', role: 'student' });
      const account = await makeExternalAccount(student, {
        type: 'claude',
        external_id: 'claude-member-abc',
        status: 'active',
      });

      const agent = await loginAs('admin-suspend@example.com', 'admin');
      const res = await agent.post(`/api/admin/external-accounts/${account.id}/suspend`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: account.id,
        userId: student.id,
        type: 'claude',
        status: 'suspended',
      });
      expect(res.body.statusChangedAt).not.toBeNull();

      // Verify DB row is updated
      const dbRow = await (prisma as any).externalAccount.findUnique({ where: { id: account.id } });
      expect(dbRow.status).toBe('suspended');
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 422 — already suspended or removed
// ---------------------------------------------------------------------------

describe('POST /api/admin/external-accounts/:id/suspend — already removed', () => {
  it('returns 422 when account is already removed', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const fakeClaude = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClaudeClient(fakeGoogle, fakeClaude);

    try {
      await makeUser({ primary_email: 'admin-suspend-422@example.com', role: 'admin' });
      const student = await makeUser({ primary_email: 'student-s422@example.com', role: 'student' });
      const account = await makeExternalAccount(student, {
        type: 'claude',
        external_id: 'claude-member-removed',
        status: 'removed',
      });

      const agent = await loginAs('admin-suspend-422@example.com', 'admin');
      const res = await agent.post(`/api/admin/external-accounts/${account.id}/suspend`);

      expect(res.status).toBe(422);
      expect(res.body.error).toBeDefined();
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 404 — account not found
// ---------------------------------------------------------------------------

describe('POST /api/admin/external-accounts/:id/suspend — not found', () => {
  it('returns 404 when account does not exist', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const fakeClaude = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClaudeClient(fakeGoogle, fakeClaude);

    try {
      await makeUser({ primary_email: 'admin-suspend-404@example.com', role: 'admin' });

      const agent = await loginAs('admin-suspend-404@example.com', 'admin');
      const res = await agent.post('/api/admin/external-accounts/999999/suspend');

      expect(res.status).toBe(404);
      expect(res.body.error).toBeDefined();
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// POST /api/admin/external-accounts/:id/remove
// ===========================================================================

// ---------------------------------------------------------------------------
// 403 — non-admin
// ---------------------------------------------------------------------------

describe('POST /api/admin/external-accounts/:id/remove — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-remove@example.com', role: 'student' });
    const agent = await loginAs('student-remove@example.com', 'student');
    const res = await agent.post('/api/admin/external-accounts/1/remove');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 200 — success (claude account)
// ---------------------------------------------------------------------------

describe('POST /api/admin/external-accounts/:id/remove — success (claude)', () => {
  it('returns 200 with updated account when removing a claude account', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const fakeClaude = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClaudeClient(fakeGoogle, fakeClaude);

    try {
      await makeUser({ primary_email: 'admin-remove@example.com', role: 'admin' });
      const student = await makeUser({ primary_email: 'student-r1@example.com', role: 'student' });
      const account = await makeExternalAccount(student, {
        type: 'claude',
        external_id: 'claude-member-xyz',
        status: 'active',
      });

      const agent = await loginAs('admin-remove@example.com', 'admin');
      const res = await agent.post(`/api/admin/external-accounts/${account.id}/remove`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: account.id,
        userId: student.id,
        type: 'claude',
        status: 'removed',
      });
      expect(res.body.statusChangedAt).not.toBeNull();

      // Verify DB row is updated
      const dbRow = await (prisma as any).externalAccount.findUnique({ where: { id: account.id } });
      expect(dbRow.status).toBe('removed');
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 200 — success (workspace account sets scheduled_delete_at)
// ---------------------------------------------------------------------------

describe('POST /api/admin/external-accounts/:id/remove — success (workspace)', () => {
  it('returns 200 and sets scheduled_delete_at for a workspace account', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const fakeClaude = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClaudeClient(fakeGoogle, fakeClaude);

    try {
      await makeUser({ primary_email: 'admin-remove-ws@example.com', role: 'admin' });
      const student = await makeUser({ primary_email: 'student-rws@example.com', role: 'student' });
      const account = await makeExternalAccount(student, {
        type: 'workspace',
        external_id: 'ws-student@students.jointheleague.org',
        status: 'active',
      });

      const agent = await loginAs('admin-remove-ws@example.com', 'admin');
      const res = await agent.post(`/api/admin/external-accounts/${account.id}/remove`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        id: account.id,
        userId: student.id,
        type: 'workspace',
        status: 'removed',
      });
      // Workspace removal schedules a delete
      expect(res.body.scheduledDeleteAt).not.toBeNull();
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 422 — already removed
// ---------------------------------------------------------------------------

describe('POST /api/admin/external-accounts/:id/remove — already removed', () => {
  it('returns 422 when account is already removed', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const fakeClaude = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClaudeClient(fakeGoogle, fakeClaude);

    try {
      await makeUser({ primary_email: 'admin-remove-422@example.com', role: 'admin' });
      const student = await makeUser({ primary_email: 'student-r422@example.com', role: 'student' });
      const account = await makeExternalAccount(student, {
        type: 'claude',
        external_id: 'claude-member-gone',
        status: 'removed',
      });

      const agent = await loginAs('admin-remove-422@example.com', 'admin');
      const res = await agent.post(`/api/admin/external-accounts/${account.id}/remove`);

      expect(res.status).toBe(422);
      expect(res.body.error).toBeDefined();
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// POST /api/admin/users/:id/provision-claude
// ===========================================================================

// ---------------------------------------------------------------------------
// 403 — non-admin
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/provision-claude — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-provisionc@example.com', role: 'student' });
    const agent = await loginAs('student-provisionc@example.com', 'student');
    const res = await agent.post('/api/admin/users/1/provision-claude');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 201 — success
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/provision-claude — success', () => {
  it('returns 201 with new ExternalAccount when student has active workspace account', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const fakeClaude = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClaudeClient(fakeGoogle, fakeClaude);

    try {
      await makeUser({ primary_email: 'admin-prov-claude@example.com', role: 'admin' });
      const student = await makeUser({
        primary_email: 'student-pc1@example.com',
        role: 'student',
      });
      // Must have an active workspace account
      await makeExternalAccount(student, {
        type: 'workspace',
        external_id: 'student-pc1@students.jointheleague.org',
        status: 'active',
      });

      const agent = await loginAs('admin-prov-claude@example.com', 'admin');
      const res = await agent.post(`/api/admin/users/${student.id}/provision-claude`);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        userId: student.id,
        type: 'claude',
        // Invite creates a pending seat; transitions to active once the invite is accepted
        status: 'pending',
      });
      expect(res.body.externalId).toBe('fake-claude-member-id');

      // Verify DB row created
      const dbRow = await (prisma as any).externalAccount.findFirst({
        where: { user_id: student.id, type: 'claude' },
      });
      expect(dbRow).not.toBeNull();
      // Invite creates a pending seat; transitions to active once invite is accepted
      expect(dbRow.status).toBe('pending');
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 422 — no active workspace account
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/provision-claude — no workspace account', () => {
  it('returns 422 when user has no active or pending workspace ExternalAccount', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const fakeClaude = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClaudeClient(fakeGoogle, fakeClaude);

    try {
      await makeUser({ primary_email: 'admin-prov-422@example.com', role: 'admin' });
      const student = await makeUser({
        primary_email: 'student-pc422@example.com',
        role: 'student',
      });
      // No workspace account at all — student only has a suspended workspace account
      await makeExternalAccount(student, {
        type: 'workspace',
        external_id: 'suspended@students.jointheleague.org',
        status: 'suspended',
      });

      const agent = await loginAs('admin-prov-422@example.com', 'admin');
      const res = await agent.post(`/api/admin/users/${student.id}/provision-claude`);

      expect(res.status).toBe(422);
      expect(res.body.error).toBeDefined();
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 409 — already has active claude account
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/provision-claude — already has claude', () => {
  it('returns 409 when user already has an active claude ExternalAccount', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const fakeClaude = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClaudeClient(fakeGoogle, fakeClaude);

    try {
      await makeUser({ primary_email: 'admin-prov-409@example.com', role: 'admin' });
      const student = await makeUser({
        primary_email: 'student-pc409@example.com',
        role: 'student',
      });
      // Active workspace account
      await makeExternalAccount(student, {
        type: 'workspace',
        external_id: 'student-pc409@students.jointheleague.org',
        status: 'active',
      });
      // Already has active claude account
      await makeExternalAccount(student, {
        type: 'claude',
        external_id: 'existing-claude-id',
        status: 'active',
      });

      const agent = await loginAs('admin-prov-409@example.com', 'admin');
      const res = await agent.post(`/api/admin/users/${student.id}/provision-claude`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBeDefined();
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// 404 — user not found
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/provision-claude — user not found', () => {
  it('returns 422 when user does not exist (UnprocessableError from service)', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const fakeClaude = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClaudeClient(fakeGoogle, fakeClaude);

    try {
      await makeUser({ primary_email: 'admin-prov-404@example.com', role: 'admin' });

      const agent = await loginAs('admin-prov-404@example.com', 'admin');
      const res = await agent.post('/api/admin/users/999999/provision-claude');

      // The service throws UnprocessableError (422) for missing user
      expect(res.status).toBe(422);
      expect(res.body.error).toBeDefined();
    } finally {
      restore();
    }
  });
});
