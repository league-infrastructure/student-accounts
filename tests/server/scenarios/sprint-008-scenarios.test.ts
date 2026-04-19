/**
 * Sprint 008 scenario tests — T004.
 *
 * End-to-end integration tests for bulk cohort suspend/remove:
 *   BulkCohortService (via ExternalAccountLifecycleService with fake clients)
 *   → admin bulk-cohort routes (GET bulk-preview, POST bulk-suspend, POST bulk-remove)
 *   → real SQLite test database.
 *
 * These tests use a real SQLite test database, FakeGoogleWorkspaceAdminClient and
 * FakeClaudeTeamAdminClient to avoid network calls, and supertest for HTTP assertions.
 *
 * COVERAGE provided here:
 *
 *  Scenario 1: GET /bulk-preview — returns expected suspend/remove eligible counts.
 *    Seeds 3 active workspace accounts. Preview returns 3 for suspend and 3 for
 *    remove. A fourth account with status=removed is excluded from both counts.
 *
 *  Scenario 2: POST /bulk-suspend workspace — all 3 succeed → HTTP 200.
 *    Asserts ExternalAccount.status='suspended' for all 3, suspend_workspace
 *    AuditEvents for all 3, succeeded=[...] in response body.
 *
 *  Scenario 3: POST /bulk-suspend claude — all 3 succeed → HTTP 200.
 *    Asserts ExternalAccount.status='suspended' and suspend_claude AuditEvents.
 *
 *  Scenario 4: POST /bulk-remove workspace — sets status=removed and scheduled_delete_at.
 *    3 active workspace accounts removed → status=removed, scheduled_delete_at ~3 days
 *    from now, remove_workspace AuditEvents.
 *
 *  Scenario 5: POST /bulk-remove claude — sets status=removed, no scheduled_delete_at.
 *    3 active claude accounts removed → status=removed, no scheduled_delete_at,
 *    remove_claude AuditEvents.
 *
 *  Scenario 6: POST /bulk-suspend workspace — partial failure (1 of 3 fails).
 *    FakeGoogleWorkspaceAdminClient throws WorkspaceApiError for the second user's
 *    email. Response is HTTP 207. DB shows 2 succeeded (status=suspended), 1 unchanged
 *    (status=active). AuditEvents for 2 succeeded accounts; none for the failing one.
 *
 *  Scenario 7: Non-admin request returns 401/403.
 *    Unauthenticated GET bulk-preview → 401. Student session bulk-suspend → 403.
 *
 *  Scenario 8: Accounts already removed are excluded from preview and not processed.
 *    Cohort has 2 active + 1 removed. Preview returns 2. POST bulk-suspend processes
 *    only the 2 active accounts.
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { ExternalAccountLifecycleService } from '../../../server/src/services/external-account-lifecycle.service.js';
import { BulkCohortService } from '../../../server/src/services/bulk-cohort.service.js';
import { ExternalAccountRepository } from '../../../server/src/services/repositories/external-account.repository.js';
import { UserRepository } from '../../../server/src/services/repositories/user.repository.js';
import { CohortRepository } from '../../../server/src/services/repositories/cohort.repository.js';
import { WorkspaceApiError } from '../../../server/src/services/google-workspace/google-workspace-admin.client.js';
import { FakeGoogleWorkspaceAdminClient } from '../helpers/fake-google-workspace-admin.client.js';
import { FakeClaudeTeamAdminClient } from '../helpers/fake-claude-team-admin.client.js';
import { makeCohort, makeUser, makeExternalAccount } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

/**
 * Inject fake Google and Claude clients into the app's singleton registry by
 * replacing the externalAccountLifecycle and bulkCohort service instances.
 * Returns a cleanup function that restores the originals.
 */
function injectFakeClients(
  googleFake: FakeGoogleWorkspaceAdminClient,
  claudeFake: FakeClaudeTeamAdminClient,
): () => void {
  const originalLifecycle = (registry as any).externalAccountLifecycle;
  const originalBulkCohort = (registry as any).bulkCohort;

  const audit = new AuditService();
  const newLifecycle = new ExternalAccountLifecycleService(
    googleFake,
    claudeFake,
    ExternalAccountRepository,
    audit,
  );
  const newBulkCohort = new BulkCohortService(
    prisma,
    newLifecycle,
    UserRepository,
    ExternalAccountRepository,
    CohortRepository,
  );

  (registry as any).externalAccountLifecycle = newLifecycle;
  (registry as any).bulkCohort = newBulkCohort;

  return () => {
    (registry as any).externalAccountLifecycle = originalLifecycle;
    (registry as any).bulkCohort = originalBulkCohort;
  };
}

/**
 * Create a supertest agent with an active admin session.
 */
async function loginAsAdmin(email: string): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/test-login').send({ email, role: 'admin' });
  if (res.status !== 200) {
    throw new Error(`test-login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

/**
 * Create a supertest agent with a student session.
 */
async function loginAsStudent(email: string): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/test-login').send({ email, role: 'student' });
  if (res.status !== 200) {
    throw new Error(`test-login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
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
// Scenario 1: GET bulk-preview — returns correct eligible counts
// ===========================================================================

describe('Scenario 1 (T004): GET /bulk-preview returns correct suspend/remove eligible counts', () => {
  it('returns eligibleCount=3 for suspend, and excludes removed accounts', async () => {
    await makeUser({ primary_email: 'admin-s1@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Spring 2025' });

    // 3 active workspace accounts
    for (let i = 1; i <= 3; i++) {
      const user = await makeUser({
        primary_email: `student-s1-${i}@example.com`,
        role: 'student',
        cohort_id: cohort.id,
      });
      await makeExternalAccount(user, {
        type: 'workspace',
        external_id: `student-s1-${i}@students.example.com`,
        status: 'active',
      });
    }

    // 1 already-removed workspace account (should NOT be counted by suspend preview)
    const removedUser = await makeUser({
      primary_email: 'student-s1-removed@example.com',
      role: 'student',
      cohort_id: cohort.id,
    });
    await makeExternalAccount(removedUser, {
      type: 'workspace',
      external_id: 'student-s1-removed@students.example.com',
      status: 'removed',
    });

    const agent = await loginAsAdmin('admin-s1@example.com');

    const suspendRes = await agent
      .get(`/api/admin/cohorts/${cohort.id}/bulk-preview`)
      .query({ accountType: 'workspace', operation: 'suspend' });

    expect(suspendRes.status).toBe(200);
    expect(suspendRes.body.eligibleCount).toBe(3);

    const removeRes = await agent
      .get(`/api/admin/cohorts/${cohort.id}/bulk-preview`)
      .query({ accountType: 'workspace', operation: 'remove' });

    expect(removeRes.status).toBe(200);
    // Active accounts are eligible for remove too
    expect(removeRes.body.eligibleCount).toBe(3);
  });
});

// ===========================================================================
// Scenario 2: POST /bulk-suspend workspace — all 3 succeed → HTTP 200
// ===========================================================================

describe('Scenario 2 (T004): POST /bulk-suspend workspace — 3 accounts all succeed → 200', () => {
  it('sets status=suspended for all 3, emits suspend_workspace audit events', async () => {
    await makeUser({ primary_email: 'admin-s2@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Fall 2025 WS' });

    const accounts: Array<{ id: number }> = [];
    for (let i = 1; i <= 3; i++) {
      const user = await makeUser({
        primary_email: `ws-student-s2-${i}@example.com`,
        role: 'student',
        cohort_id: cohort.id,
      });
      const acct = await makeExternalAccount(user, {
        type: 'workspace',
        external_id: `ws-student-s2-${i}@students.example.com`,
        status: 'active',
      });
      accounts.push(acct);
    }

    const googleFake = new FakeGoogleWorkspaceAdminClient();
    const claudeFake = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClients(googleFake, claudeFake);

    try {
      const agent = await loginAsAdmin('admin-s2@example.com');
      const res = await agent
        .post(`/api/admin/cohorts/${cohort.id}/bulk-suspend`)
        .send({ accountType: 'workspace' });

      expect(res.status).toBe(200);
      expect(res.body.succeeded).toHaveLength(3);
      expect(res.body.failed).toHaveLength(0);

      // DB: all accounts now suspended
      for (const acct of accounts) {
        const dbAcct = await (prisma as any).externalAccount.findUnique({
          where: { id: acct.id },
        });
        expect(dbAcct.status).toBe('suspended');
      }

      // AuditEvents: 3 suspend_workspace events
      const auditEvents = await (prisma as any).auditEvent.findMany({
        where: { action: 'suspend_workspace' },
      });
      expect(auditEvents).toHaveLength(3);

      // FakeClient suspendUser called 3 times
      expect(googleFake.calls.suspendUser).toHaveLength(3);
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// Scenario 3: POST /bulk-suspend claude — all 3 succeed → HTTP 200
// ===========================================================================

describe('Scenario 3 (T004): POST /bulk-suspend claude — 3 accounts all succeed → 200', () => {
  it('sets status=suspended for all 3, emits suspend_claude audit events', async () => {
    await makeUser({ primary_email: 'admin-s3@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Fall 2025 Claude' });

    const accounts: Array<{ id: number }> = [];
    for (let i = 1; i <= 3; i++) {
      const user = await makeUser({
        primary_email: `claude-student-s3-${i}@example.com`,
        role: 'student',
        cohort_id: cohort.id,
      });
      const acct = await makeExternalAccount(user, {
        type: 'claude',
        external_id: `claude-member-id-s3-${i}`,
        status: 'active',
      });
      accounts.push(acct);
    }

    const googleFake = new FakeGoogleWorkspaceAdminClient();
    const claudeFake = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClients(googleFake, claudeFake);

    try {
      const agent = await loginAsAdmin('admin-s3@example.com');
      const res = await agent
        .post(`/api/admin/cohorts/${cohort.id}/bulk-suspend`)
        .send({ accountType: 'claude' });

      expect(res.status).toBe(200);
      expect(res.body.succeeded).toHaveLength(3);
      expect(res.body.failed).toHaveLength(0);

      // DB: all accounts now suspended
      for (const acct of accounts) {
        const dbAcct = await (prisma as any).externalAccount.findUnique({
          where: { id: acct.id },
        });
        expect(dbAcct.status).toBe('suspended');
      }

      // AuditEvents: 3 suspend_claude events
      const auditEvents = await (prisma as any).auditEvent.findMany({
        where: { action: 'suspend_claude' },
      });
      expect(auditEvents).toHaveLength(3);
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// Scenario 4: POST /bulk-remove workspace — sets status=removed + scheduled_delete_at
// ===========================================================================

describe('Scenario 4 (T004): POST /bulk-remove workspace — status=removed + scheduled_delete_at set', () => {
  it('marks 3 workspace accounts removed with scheduled_delete_at ~3 days from now', async () => {
    await makeUser({ primary_email: 'admin-s4@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Cohort Remove WS' });

    const accounts: Array<{ id: number }> = [];
    for (let i = 1; i <= 3; i++) {
      const user = await makeUser({
        primary_email: `ws-remove-s4-${i}@example.com`,
        role: 'student',
        cohort_id: cohort.id,
      });
      const acct = await makeExternalAccount(user, {
        type: 'workspace',
        external_id: `ws-remove-s4-${i}@students.example.com`,
        status: 'active',
      });
      accounts.push(acct);
    }

    const googleFake = new FakeGoogleWorkspaceAdminClient();
    const claudeFake = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClients(googleFake, claudeFake);

    try {
      const agent = await loginAsAdmin('admin-s4@example.com');
      const before = Date.now();

      const res = await agent
        .post(`/api/admin/cohorts/${cohort.id}/bulk-remove`)
        .send({ accountType: 'workspace' });

      const after = Date.now();

      expect(res.status).toBe(200);
      expect(res.body.succeeded).toHaveLength(3);
      expect(res.body.failed).toHaveLength(0);

      // DB: all accounts removed with scheduled_delete_at ~3 days from now
      for (const acct of accounts) {
        const dbAcct = await (prisma as any).externalAccount.findUnique({
          where: { id: acct.id },
        });
        expect(dbAcct.status).toBe('removed');
        expect(dbAcct.scheduled_delete_at).not.toBeNull();

        // scheduled_delete_at should be approximately 3 days from now
        const deleteAt = new Date(dbAcct.scheduled_delete_at).getTime();
        const threeDaysMs = 3 * 24 * 60 * 60 * 1000;
        expect(deleteAt).toBeGreaterThanOrEqual(before + threeDaysMs - 5000);
        expect(deleteAt).toBeLessThanOrEqual(after + threeDaysMs + 5000);
      }

      // AuditEvents: 3 remove_workspace events
      const auditEvents = await (prisma as any).auditEvent.findMany({
        where: { action: 'remove_workspace' },
      });
      expect(auditEvents).toHaveLength(3);
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// Scenario 5: POST /bulk-remove claude — status=removed, no scheduled_delete_at
// ===========================================================================

describe('Scenario 5 (T004): POST /bulk-remove claude — status=removed, no scheduled_delete_at', () => {
  it('marks 3 claude accounts removed without scheduled_delete_at', async () => {
    await makeUser({ primary_email: 'admin-s5@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Cohort Remove Claude' });

    const accounts: Array<{ id: number }> = [];
    for (let i = 1; i <= 3; i++) {
      const user = await makeUser({
        primary_email: `claude-remove-s5-${i}@example.com`,
        role: 'student',
        cohort_id: cohort.id,
      });
      const acct = await makeExternalAccount(user, {
        type: 'claude',
        external_id: `claude-member-s5-${i}`,
        status: 'active',
      });
      accounts.push(acct);
    }

    const googleFake = new FakeGoogleWorkspaceAdminClient();
    const claudeFake = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClients(googleFake, claudeFake);

    try {
      const agent = await loginAsAdmin('admin-s5@example.com');
      const res = await agent
        .post(`/api/admin/cohorts/${cohort.id}/bulk-remove`)
        .send({ accountType: 'claude' });

      expect(res.status).toBe(200);
      expect(res.body.succeeded).toHaveLength(3);
      expect(res.body.failed).toHaveLength(0);

      // DB: all accounts removed, NO scheduled_delete_at
      for (const acct of accounts) {
        const dbAcct = await (prisma as any).externalAccount.findUnique({
          where: { id: acct.id },
        });
        expect(dbAcct.status).toBe('removed');
        expect(dbAcct.scheduled_delete_at).toBeNull();
      }

      // AuditEvents: 3 remove_claude events
      const auditEvents = await (prisma as any).auditEvent.findMany({
        where: { action: 'remove_claude' },
      });
      expect(auditEvents).toHaveLength(3);

      // FakeClaudeClient removeMember called 3 times
      expect(claudeFake.calls.removeMember).toHaveLength(3);
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// Scenario 6: POST /bulk-suspend workspace — partial failure (1 of 3 fails)
// ===========================================================================

describe('Scenario 6 (T004): POST /bulk-suspend workspace — 1 of 3 fails → HTTP 207', () => {
  it('returns 207 with 2 succeeded and 1 failed; DB shows 1 account still active', async () => {
    await makeUser({ primary_email: 'admin-s6@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Partial Fail Cohort' });

    // Create 3 users with workspace accounts
    const users: Array<{ id: number; email: string }> = [];
    const accounts: Array<{ id: number; external_id: string }> = [];

    for (let i = 1; i <= 3; i++) {
      const wsEmail = `ws-partial-s6-${i}@students.example.com`;
      const user = await makeUser({
        primary_email: `student-s6-${i}@example.com`,
        role: 'student',
        cohort_id: cohort.id,
      });
      const acct = await makeExternalAccount(user, {
        type: 'workspace',
        external_id: wsEmail,
        status: 'active',
      });
      users.push({ id: user.id, email: wsEmail });
      accounts.push({ id: acct.id, external_id: wsEmail });
    }

    // Configure FakeClient to throw on the second user's workspace email
    const failingEmail = accounts[1].external_id;
    const googleFake = new FakeGoogleWorkspaceAdminClient();
    googleFake.configureError(
      'suspendUser',
      new WorkspaceApiError(`Failed to suspend ${failingEmail}`, 'suspendUser', 500),
    );
    // NOTE: configureError applies to ALL suspendUser calls; we use a per-email
    // approach via a custom suspendUser override below to only fail the second account.

    // Replace googleFake with a selective-failure version
    const selectiveGoogleFake = new FakeGoogleWorkspaceAdminClient();
    // Intercept suspendUser to throw only for the second email
    const originalSuspendUser = selectiveGoogleFake.suspendUser.bind(selectiveGoogleFake);
    (selectiveGoogleFake as any).suspendUser = async (email: string): Promise<void> => {
      selectiveGoogleFake.calls.suspendUser.push(email);
      if (email === failingEmail) {
        throw new WorkspaceApiError(
          `Simulated failure for ${email}`,
          'suspendUser',
          500,
        );
      }
      // success for other emails
    };

    const claudeFake = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClients(selectiveGoogleFake, claudeFake);

    try {
      const agent = await loginAsAdmin('admin-s6@example.com');
      const res = await agent
        .post(`/api/admin/cohorts/${cohort.id}/bulk-suspend`)
        .send({ accountType: 'workspace' });

      // HTTP 207 because 1 failed and 2 succeeded
      expect(res.status).toBe(207);
      expect(res.body.succeeded).toHaveLength(2);
      expect(res.body.failed).toHaveLength(1);

      const failureReport = res.body.failed[0];
      expect(failureReport.accountId).toBe(accounts[1].id);
      expect(typeof failureReport.error).toBe('string');

      // DB: account 0 and account 2 are suspended; account 1 is still active
      const dbAcct0 = await (prisma as any).externalAccount.findUnique({
        where: { id: accounts[0].id },
      });
      expect(dbAcct0.status).toBe('suspended');

      const dbAcct1 = await (prisma as any).externalAccount.findUnique({
        where: { id: accounts[1].id },
      });
      expect(dbAcct1.status).toBe('active');

      const dbAcct2 = await (prisma as any).externalAccount.findUnique({
        where: { id: accounts[2].id },
      });
      expect(dbAcct2.status).toBe('suspended');

      // AuditEvents: 2 suspend_workspace events (not 3 — the failed one has no event)
      const auditEvents = await (prisma as any).auditEvent.findMany({
        where: { action: 'suspend_workspace' },
      });
      expect(auditEvents).toHaveLength(2);
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// Scenario 7: Non-admin requests are rejected
// ===========================================================================

describe('Scenario 7 (T004): Non-admin requests return 401/403', () => {
  it('returns 401 for unauthenticated GET /bulk-preview', async () => {
    const cohort = await makeCohort({ name: 'Auth Test Cohort' });
    const unauthAgent = request.agent(app);

    const res = await unauthAgent
      .get(`/api/admin/cohorts/${cohort.id}/bulk-preview`)
      .query({ accountType: 'workspace', operation: 'suspend' });

    expect(res.status).toBe(401);
  });

  it('returns 403 for a student session on POST /bulk-suspend', async () => {
    const cohort = await makeCohort({ name: 'Auth Test Cohort 2' });
    await makeUser({ primary_email: 'student-s7@example.com', role: 'student' });

    const studentAgent = await loginAsStudent('student-s7@example.com');
    const res = await studentAgent
      .post(`/api/admin/cohorts/${cohort.id}/bulk-suspend`)
      .send({ accountType: 'workspace' });

    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// Scenario 8: Already-removed accounts excluded from preview and processing
// ===========================================================================

describe('Scenario 8 (T004): Already-removed accounts are excluded from preview and processing', () => {
  it('preview returns 2 for 2 active + 1 removed; bulk-suspend processes only 2', async () => {
    await makeUser({ primary_email: 'admin-s8@example.com', role: 'admin' });
    const cohort = await makeCohort({ name: 'Removed Exclusion Cohort' });

    const activeAccounts: Array<{ id: number }> = [];

    // 2 active accounts
    for (let i = 1; i <= 2; i++) {
      const user = await makeUser({
        primary_email: `ws-s8-active-${i}@example.com`,
        role: 'student',
        cohort_id: cohort.id,
      });
      const acct = await makeExternalAccount(user, {
        type: 'workspace',
        external_id: `ws-s8-active-${i}@students.example.com`,
        status: 'active',
      });
      activeAccounts.push(acct);
    }

    // 1 already-removed account
    const removedUser = await makeUser({
      primary_email: 'ws-s8-removed@example.com',
      role: 'student',
      cohort_id: cohort.id,
    });
    const removedAcct = await makeExternalAccount(removedUser, {
      type: 'workspace',
      external_id: 'ws-s8-removed@students.example.com',
      status: 'removed',
    });

    const googleFake = new FakeGoogleWorkspaceAdminClient();
    const claudeFake = new FakeClaudeTeamAdminClient();
    const restore = injectFakeClients(googleFake, claudeFake);

    try {
      const agent = await loginAsAdmin('admin-s8@example.com');

      // Preview should show only 2
      const previewRes = await agent
        .get(`/api/admin/cohorts/${cohort.id}/bulk-preview`)
        .query({ accountType: 'workspace', operation: 'suspend' });

      expect(previewRes.status).toBe(200);
      expect(previewRes.body.eligibleCount).toBe(2);

      // Bulk-suspend processes only 2
      const suspendRes = await agent
        .post(`/api/admin/cohorts/${cohort.id}/bulk-suspend`)
        .send({ accountType: 'workspace' });

      expect(suspendRes.status).toBe(200);
      expect(suspendRes.body.succeeded).toHaveLength(2);
      expect(suspendRes.body.failed).toHaveLength(0);

      // Active accounts are now suspended
      for (const acct of activeAccounts) {
        const dbAcct = await (prisma as any).externalAccount.findUnique({
          where: { id: acct.id },
        });
        expect(dbAcct.status).toBe('suspended');
      }

      // Removed account is untouched
      const dbRemoved = await (prisma as any).externalAccount.findUnique({
        where: { id: removedAcct.id },
      });
      expect(dbRemoved.status).toBe('removed');

      // Only 2 AuditEvents
      const auditEvents = await (prisma as any).auditEvent.findMany({
        where: { action: 'suspend_workspace' },
      });
      expect(auditEvents).toHaveLength(2);
    } finally {
      restore();
    }
  });
});
