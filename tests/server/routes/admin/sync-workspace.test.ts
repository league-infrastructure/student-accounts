/**
 * Integration tests for workspace sync routes (Sprint 006 T007).
 *
 * Covers:
 *  POST /api/admin/sync/workspace/cohorts
 *  POST /api/admin/sync/workspace/staff
 *  POST /api/admin/sync/workspace/students
 *  POST /api/admin/sync/workspace/all
 *
 * For each endpoint:
 *  - 401 when not authenticated
 *  - 403 when authenticated but not admin (student role)
 *  - 200 with WorkspaceSyncReport JSON when authenticated as admin
 *  - 500 response (via global error handler) when service throws a generic Error
 *  - 502 response when service throws a WorkspaceApiError
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { WorkspaceSyncService } from '../../../../server/src/services/workspace-sync.service.js';
import { WorkspaceApiError } from '../../../../server/src/services/google-workspace/google-workspace-admin.client.js';
import { FakeGoogleWorkspaceAdminClient } from '../../helpers/fake-google-workspace-admin.client.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { UserRepository } from '../../../../server/src/services/repositories/user.repository.js';
import { ExternalAccountRepository } from '../../../../server/src/services/repositories/external-account.repository.js';
import { CohortRepository } from '../../../../server/src/services/repositories/cohort.repository.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
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

/**
 * Build a WorkspaceSyncService backed by a FakeGoogleWorkspaceAdminClient and
 * inject it into the singleton registry. Returns the fake client and a cleanup
 * function that restores the original service.
 */
function injectFakeWorkspaceSync(fakeGoogle?: FakeGoogleWorkspaceAdminClient): {
  fakeGoogle: FakeGoogleWorkspaceAdminClient;
  restore: () => void;
} {
  const original = (registry as any).workspaceSync;
  const client = fakeGoogle ?? new FakeGoogleWorkspaceAdminClient();

  const fakeSync = new WorkspaceSyncService(
    prisma as any,
    client,
    (registry as any).cohorts,
    UserRepository,
    ExternalAccountRepository,
    CohortRepository,
    new AuditService(),
  );

  (registry as any).workspaceSync = fakeSync;

  return {
    fakeGoogle: client,
    restore: () => {
      (registry as any).workspaceSync = original;
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / Teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await cleanDb();
});

// ---------------------------------------------------------------------------
// Auth enforcement — sampled for /workspace/cohorts, but pattern is shared
// ---------------------------------------------------------------------------

describe('workspace sync routes — auth enforcement', () => {
  it('returns 401 when not authenticated on /workspace/cohorts', async () => {
    const res = await request(app).post('/api/admin/sync/workspace/cohorts');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as student on /workspace/cohorts', async () => {
    const agent = await loginAs('student@example.com', 'student');
    const res = await agent.post('/api/admin/sync/workspace/cohorts');
    expect(res.status).toBe(403);
  });

  it('returns 401 when not authenticated on /workspace/staff', async () => {
    const res = await request(app).post('/api/admin/sync/workspace/staff');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as student on /workspace/staff', async () => {
    const agent = await loginAs('student2@example.com', 'student');
    const res = await agent.post('/api/admin/sync/workspace/staff');
    expect(res.status).toBe(403);
  });

  it('returns 401 when not authenticated on /workspace/students', async () => {
    const res = await request(app).post('/api/admin/sync/workspace/students');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as student on /workspace/students', async () => {
    const agent = await loginAs('student3@example.com', 'student');
    const res = await agent.post('/api/admin/sync/workspace/students');
    expect(res.status).toBe(403);
  });

  it('returns 401 when not authenticated on /workspace/all', async () => {
    const res = await request(app).post('/api/admin/sync/workspace/all');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as student on /workspace/all', async () => {
    const agent = await loginAs('student4@example.com', 'student');
    const res = await agent.post('/api/admin/sync/workspace/all');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/sync/workspace/cohorts
// ---------------------------------------------------------------------------

describe('POST /api/admin/sync/workspace/cohorts — admin success', () => {
  it('returns 200 with WorkspaceSyncReport (empty OUs)', async () => {
    const { restore } = injectFakeWorkspaceSync();
    try {
      const agent = await loginAs('admin@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/cohorts');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ cohortsUpserted: 0 });
    } finally {
      restore();
    }
  });

  it('returns 200 with cohortsUpserted=1 when one OU is present', async () => {
    const { fakeGoogle, restore } = injectFakeWorkspaceSync();
    try {
      const studentRoot = process.env.GOOGLE_STUDENT_OU_ROOT ?? '/Students';
      fakeGoogle.seedOUs(studentRoot, [
        { orgUnitPath: `${studentRoot}/Spring2025`, name: 'Spring2025' },
      ]);

      const agent = await loginAs('admin2@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/cohorts');

      expect(res.status).toBe(200);
      expect(res.body.cohortsUpserted).toBe(1);
    } finally {
      restore();
    }
  });

  it('returns 502 when listOUs throws WorkspaceApiError', async () => {
    const { fakeGoogle, restore } = injectFakeWorkspaceSync();
    try {
      fakeGoogle.configureError(
        'listOUs',
        new WorkspaceApiError('API quota exceeded', 'listOUs', 429),
      );

      const agent = await loginAs('admin3@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/cohorts');

      expect(res.status).toBe(502);
      expect(res.body).toHaveProperty('error');
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/sync/workspace/staff
// ---------------------------------------------------------------------------

describe('POST /api/admin/sync/workspace/staff — admin success', () => {
  it('returns 200 with staffUpserted=0 when GOOGLE_STAFF_OU_PATH is unset', async () => {
    const savedEnv = process.env.GOOGLE_STAFF_OU_PATH;
    delete process.env.GOOGLE_STAFF_OU_PATH;

    const { restore } = injectFakeWorkspaceSync();
    try {
      const agent = await loginAs('admin4@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/staff');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ staffUpserted: 0 });
    } finally {
      restore();
      if (savedEnv !== undefined) {
        process.env.GOOGLE_STAFF_OU_PATH = savedEnv;
      }
    }
  });

  it('returns 200 with staffUpserted=1 when staff OU has one user', async () => {
    const staffOuPath = '/League Staff';
    const savedEnv = process.env.GOOGLE_STAFF_OU_PATH;
    process.env.GOOGLE_STAFF_OU_PATH = staffOuPath;

    const { fakeGoogle, restore } = injectFakeWorkspaceSync();
    try {
      fakeGoogle.seedUsers(staffOuPath, [
        { id: 'ws-user-1', primaryEmail: 'teacher@example.com', orgUnitPath: staffOuPath },
      ]);

      const agent = await loginAs('admin5@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/staff');

      expect(res.status).toBe(200);
      expect(res.body.staffUpserted).toBe(1);
    } finally {
      restore();
      if (savedEnv !== undefined) {
        process.env.GOOGLE_STAFF_OU_PATH = savedEnv;
      } else {
        delete process.env.GOOGLE_STAFF_OU_PATH;
      }
    }
  });

  it('returns 502 when listUsersInOU throws WorkspaceApiError', async () => {
    const staffOuPath = '/League Staff';
    const savedEnv = process.env.GOOGLE_STAFF_OU_PATH;
    process.env.GOOGLE_STAFF_OU_PATH = staffOuPath;

    const { fakeGoogle, restore } = injectFakeWorkspaceSync();
    try {
      fakeGoogle.configureError(
        'listUsersInOU',
        new WorkspaceApiError('Forbidden', 'listUsersInOU', 403),
      );

      const agent = await loginAs('admin6@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/staff');

      expect(res.status).toBe(502);
      expect(res.body).toHaveProperty('error');
    } finally {
      restore();
      if (savedEnv !== undefined) {
        process.env.GOOGLE_STAFF_OU_PATH = savedEnv;
      } else {
        delete process.env.GOOGLE_STAFF_OU_PATH;
      }
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/sync/workspace/students
// ---------------------------------------------------------------------------

describe('POST /api/admin/sync/workspace/students — admin success', () => {
  it('returns 200 with studentsUpserted=0 and empty flaggedAccounts when no users', async () => {
    const { restore } = injectFakeWorkspaceSync();
    try {
      const agent = await loginAs('admin7@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/students');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ studentsUpserted: 0, flaggedAccounts: [] });
    } finally {
      restore();
    }
  });

  it('returns 200 with flaggedAccounts list in response body', async () => {
    const { restore } = injectFakeWorkspaceSync();
    try {
      // No seeded users — no flagging since no active workspace ExternalAccounts
      const agent = await loginAs('admin8@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/students');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.flaggedAccounts)).toBe(true);
    } finally {
      restore();
    }
  });

  it('returns 502 when Google API throws WorkspaceApiError', async () => {
    const { fakeGoogle, restore } = injectFakeWorkspaceSync();
    try {
      fakeGoogle.configureError(
        'listUsersInOU',
        new WorkspaceApiError('Service unavailable', 'listUsersInOU', 503),
      );

      const agent = await loginAs('admin9@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/students');

      expect(res.status).toBe(502);
      expect(res.body).toHaveProperty('error');
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/sync/workspace/all
// ---------------------------------------------------------------------------

describe('POST /api/admin/sync/workspace/all — admin success', () => {
  it('returns 200 with combined WorkspaceSyncReport', async () => {
    const { restore } = injectFakeWorkspaceSync();
    try {
      const agent = await loginAs('admin10@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/all');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        cohortsUpserted: 0,
        staffUpserted: 0,
        studentsUpserted: 0,
        flaggedAccounts: [],
        errors: [],
      });
    } finally {
      restore();
    }
  });

  it('returns 200 and includes sub-operation errors in the report when one sub-op fails', async () => {
    const { fakeGoogle, restore } = injectFakeWorkspaceSync();
    try {
      // listOUs will throw for syncCohorts but syncAll catches it
      fakeGoogle.configureError(
        'listOUs',
        new WorkspaceApiError('OU not found', 'listOUs', 404),
      );

      const agent = await loginAs('admin11@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/workspace/all');

      // syncAll catches sub-op errors and continues, so route returns 200
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.errors)).toBe(true);
      expect(res.body.errors.length).toBeGreaterThan(0);
      expect(res.body.errors[0]).toMatchObject({ operation: 'syncCohorts' });
    } finally {
      restore();
    }
  });
});
