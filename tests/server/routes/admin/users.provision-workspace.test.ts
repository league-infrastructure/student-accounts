/**
 * Integration tests for POST /api/admin/users/:id/provision-workspace (Sprint 010 T004).
 *
 * Covers:
 *  - 201 success: student with cohort + no workspace account gets account created.
 *  - 422: user is not role=student.
 *  - 422: student has no cohort assigned.
 *  - 422: student cohort has no google_ou_path.
 *  - 409: student already has an active workspace ExternalAccount.
 *  - 409: student already has a pending workspace ExternalAccount.
 *  - 502: WorkspaceApiError thrown from GoogleWorkspaceAdminClient.
 *  - 401: unauthenticated request.
 *  - 403: non-admin role.
 *
 * Strategy: inject a FakeGoogleWorkspaceAdminClient-backed WorkspaceProvisioningService
 * into the singleton app registry to avoid real Google API calls.
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { FakeGoogleWorkspaceAdminClient } from '../../helpers/fake-google-workspace-admin.client.js';
import { WorkspaceProvisioningService } from '../../../../server/src/services/workspace-provisioning.service.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { ExternalAccountRepository } from '../../../../server/src/services/repositories/external-account.repository.js';
import { UserRepository } from '../../../../server/src/services/repositories/user.repository.js';
import { WorkspaceApiError } from '../../../../server/src/services/google-workspace/google-workspace-admin.client.js';
import type { MailService } from '../../../../server/src/services/mail.service.js';
import { vi } from 'vitest';
import { makeUser, makeCohort, makeExternalAccount } from '../../helpers/factories.js';

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

async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
}

function makeMailMock(): MailService {
  return {
    isConfigured: () => true,
    send: vi.fn().mockResolvedValue({ messageId: 'mock-msg-id' }),
  } as unknown as MailService;
}

/**
 * Inject a WorkspaceProvisioningService backed by the given FakeGoogleWorkspaceAdminClient
 * into the app's singleton registry. Returns a cleanup function that restores the original.
 */
function injectFakeWorkspaceProvisioning(fakeGoogle: FakeGoogleWorkspaceAdminClient): () => void {
  const original = (registry as any).workspaceProvisioning;

  const fakeService = new WorkspaceProvisioningService(
    fakeGoogle,
    ExternalAccountRepository,
    new AuditService(),
    UserRepository,
    makeMailMock(),
  );

  (registry as any).workspaceProvisioning = fakeService;

  return () => {
    (registry as any).workspaceProvisioning = original;
  };
}

const STUDENT_DOMAIN = 'students.jointheleague.org';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

let savedDomain: string | undefined;
let savedTempPassword: string | undefined;

beforeEach(async () => {
  await cleanDb();
  savedDomain = process.env.GOOGLE_STUDENT_DOMAIN;
  savedTempPassword = process.env.GOOGLE_WORKSPACE_TEMP_PASSWORD;
  process.env.GOOGLE_STUDENT_DOMAIN = STUDENT_DOMAIN;
  process.env.GOOGLE_WORKSPACE_TEMP_PASSWORD = 'route-test-temp-password';
});

afterEach(async () => {
  if (savedDomain !== undefined) {
    process.env.GOOGLE_STUDENT_DOMAIN = savedDomain;
  } else {
    delete process.env.GOOGLE_STUDENT_DOMAIN;
  }
  if (savedTempPassword !== undefined) {
    process.env.GOOGLE_WORKSPACE_TEMP_PASSWORD = savedTempPassword;
  } else {
    delete process.env.GOOGLE_WORKSPACE_TEMP_PASSWORD;
  }
  vi.restoreAllMocks();
});

afterAll(async () => {
  await cleanDb();
});

// ===========================================================================
// Auth enforcement
// ===========================================================================

describe('POST /api/admin/users/:id/provision-workspace — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).post('/api/admin/users/999/provision-workspace');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/admin/users/:id/provision-workspace — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student-prov-ws@example.com', role: 'student' });
    const agent = await loginAs('student-prov-ws@example.com', 'student');
    const res = await agent.post('/api/admin/users/1/provision-workspace');
    expect(res.status).toBe(403);
  });
});

// ===========================================================================
// 201 — success
// ===========================================================================

describe('POST /api/admin/users/:id/provision-workspace — 201 success', () => {
  it('returns 201 with the created ExternalAccount when student has cohort and no workspace', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const restore = injectFakeWorkspaceProvisioning(fakeGoogle);

    try {
      await makeUser({ primary_email: 'admin-prov-ws@example.com', role: 'admin' });
      const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
      const student = await makeUser({
        primary_email: 'student-ws1@example.com',
        role: 'student',
        cohort_id: cohort.id,
        display_name: 'Alice Smith',
      });

      const agent = await loginAs('admin-prov-ws@example.com', 'admin');
      const res = await agent.post(`/api/admin/users/${student.id}/provision-workspace`);

      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({
        userId: student.id,
        type: 'workspace',
        status: 'active',
      });
      // external_id is the League email, not the Google user id.
      expect(res.body.externalId).toMatch(/@students\.jointheleague\.org$/);
      expect(res.body.id).toBeGreaterThan(0);
      expect(res.body.statusChangedAt).not.toBeNull();

      // Verify the ExternalAccount row was persisted
      const dbRow = await (prisma as any).externalAccount.findFirst({
        where: { user_id: student.id, type: 'workspace' },
      });
      expect(dbRow).not.toBeNull();
      expect(dbRow.status).toBe('active');
      expect(dbRow.external_id).toMatch(/@students\.jointheleague\.org$/);
    } finally {
      restore();
    }
  });

  it('calls GoogleWorkspaceAdminClient.createUser with correct arguments', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const restore = injectFakeWorkspaceProvisioning(fakeGoogle);

    try {
      await makeUser({ primary_email: 'admin-prov-ws2@example.com', role: 'admin' });
      const cohort = await makeCohort({ google_ou_path: '/Students/Fall2025' });
      const student = await makeUser({
        primary_email: 'student-ws2@example.com',
        role: 'student',
        cohort_id: cohort.id,
        display_name: 'Bob Jones',
      });

      const agent = await loginAs('admin-prov-ws2@example.com', 'admin');
      await agent.post(`/api/admin/users/${student.id}/provision-workspace`);

      expect(fakeGoogle.calls.createUser).toHaveLength(1);
      expect(fakeGoogle.calls.createUser[0].orgUnitPath).toBe('/Students');
      expect(fakeGoogle.calls.createUser[0].primaryEmail).toContain(STUDENT_DOMAIN);
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// 422 — user is not role=student
// ===========================================================================

describe('POST /api/admin/users/:id/provision-workspace — 422 not a student', () => {
  it('returns 422 when user is role=staff', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const restore = injectFakeWorkspaceProvisioning(fakeGoogle);

    try {
      await makeUser({ primary_email: 'admin-prov-422s@example.com', role: 'admin' });
      const staffUser = await makeUser({
        primary_email: 'staff-prov@example.com',
        role: 'staff',
      });

      const agent = await loginAs('admin-prov-422s@example.com', 'admin');
      const res = await agent.post(`/api/admin/users/${staffUser.id}/provision-workspace`);

      expect(res.status).toBe(422);
      expect(res.body.error).toBeDefined();
      expect(fakeGoogle.calls.createUser).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('returns 422 when user is role=admin', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const restore = injectFakeWorkspaceProvisioning(fakeGoogle);

    try {
      const adminUser = await makeUser({
        primary_email: 'admin-prov-self@example.com',
        role: 'admin',
      });

      const agent = await loginAs('admin-prov-self@example.com', 'admin');
      const res = await agent.post(`/api/admin/users/${adminUser.id}/provision-workspace`);

      expect(res.status).toBe(422);
      expect(res.body.error).toBeDefined();
      expect(fakeGoogle.calls.createUser).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// 201 — student without cohort: Sprint 028 T004 removed cohort requirement
// ===========================================================================

describe('POST /api/admin/users/:id/provision-workspace — 201 student with no cohort', () => {
  it('returns 201 even when student has no cohort_id (cohort check removed Sprint 028)', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const restore = injectFakeWorkspaceProvisioning(fakeGoogle);

    try {
      await makeUser({ primary_email: 'admin-prov-nc@example.com', role: 'admin' });
      const student = await makeUser({
        primary_email: 'student-nc@example.com',
        role: 'student',
        cohort_id: null,
        display_name: 'No Cohort Student',
      });

      const agent = await loginAs('admin-prov-nc@example.com', 'admin');
      const res = await agent.post(`/api/admin/users/${student.id}/provision-workspace`);

      // No longer 422 — cohort is not required
      expect(res.status).toBe(201);
      expect(fakeGoogle.calls.createUser).toHaveLength(1);
      expect(fakeGoogle.calls.createUser[0].orgUnitPath).toBe('/Students');
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// 409 — student already has an active/pending workspace ExternalAccount
// ===========================================================================

describe('POST /api/admin/users/:id/provision-workspace — 409 already has workspace', () => {
  it('returns 409 when student already has an active workspace ExternalAccount', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const restore = injectFakeWorkspaceProvisioning(fakeGoogle);

    try {
      await makeUser({ primary_email: 'admin-prov-409a@example.com', role: 'admin' });
      const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
      const student = await makeUser({
        primary_email: 'student-409a@example.com',
        role: 'student',
        cohort_id: cohort.id,
      });
      await makeExternalAccount(student, { type: 'workspace', status: 'active' });

      const agent = await loginAs('admin-prov-409a@example.com', 'admin');
      const res = await agent.post(`/api/admin/users/${student.id}/provision-workspace`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBeDefined();
      expect(fakeGoogle.calls.createUser).toHaveLength(0);
    } finally {
      restore();
    }
  });

  it('returns 409 when student already has a pending workspace ExternalAccount', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    const restore = injectFakeWorkspaceProvisioning(fakeGoogle);

    try {
      await makeUser({ primary_email: 'admin-prov-409p@example.com', role: 'admin' });
      const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
      const student = await makeUser({
        primary_email: 'student-409p@example.com',
        role: 'student',
        cohort_id: cohort.id,
      });
      await makeExternalAccount(student, { type: 'workspace', status: 'pending' });

      const agent = await loginAs('admin-prov-409p@example.com', 'admin');
      const res = await agent.post(`/api/admin/users/${student.id}/provision-workspace`);

      expect(res.status).toBe(409);
      expect(res.body.error).toBeDefined();
      expect(fakeGoogle.calls.createUser).toHaveLength(0);
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// 502 — Google Workspace API error
// ===========================================================================

describe('POST /api/admin/users/:id/provision-workspace — 502 on WorkspaceApiError', () => {
  it('returns 502 when GoogleWorkspaceAdminClient.createUser throws WorkspaceApiError', async () => {
    const fakeGoogle = new FakeGoogleWorkspaceAdminClient();
    fakeGoogle.configureError(
      'createUser',
      new WorkspaceApiError('Google API unavailable', 'createUser', 503),
    );
    const restore = injectFakeWorkspaceProvisioning(fakeGoogle);

    try {
      await makeUser({ primary_email: 'admin-prov-502@example.com', role: 'admin' });
      const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
      const student = await makeUser({
        primary_email: 'student-502@example.com',
        role: 'student',
        cohort_id: cohort.id,
      });

      const agent = await loginAs('admin-prov-502@example.com', 'admin');
      const res = await agent.post(`/api/admin/users/${student.id}/provision-workspace`);

      expect(res.status).toBe(502);
      expect(res.body.error).toBeDefined();

      // No ExternalAccount should have been persisted
      const dbRow = await (prisma as any).externalAccount.findFirst({
        where: { user_id: student.id, type: 'workspace' },
      });
      expect(dbRow).toBeNull();
    } finally {
      restore();
    }
  });
});
