/**
 * Integration tests for Anthropic sync routes (Sprint 010 T012).
 *
 * Covers:
 *  POST /api/admin/sync/claude
 *   - 401 when not authenticated
 *   - 403 when authenticated as non-admin (student)
 *   - 200 with SyncReport JSON when authenticated as admin
 *   - 503 when AnthropicSyncService.reconcile() throws AnthropicAdminApiError
 *
 *  GET /api/admin/anthropic/probe
 *   - 401 when not authenticated
 *   - 403 when authenticated as non-admin
 *   - 200 with probe result { ok, userCount, workspaces, invitesCount, writeEnabled }
 *   - 200 with ok:false when AnthropicAdminClient methods throw
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { AnthropicSyncService, type SyncReport } from '../../../../server/src/services/anthropic/anthropic-sync.service.js';
import { AnthropicAdminApiError } from '../../../../server/src/services/anthropic/anthropic-admin.client.js';
import { FakeAnthropicAdminClient } from '../../helpers/fake-anthropic-admin.client.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';

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
 * Build an AnthropicSyncService backed by the given fake client and inject
 * it into the singleton registry. Also injects the fake client itself as
 * anthropicAdmin so probe calls use the same double.
 * Returns a restore function.
 */
function injectFakeAnthropicSync(fakeClient?: FakeAnthropicAdminClient): {
  fakeClient: FakeAnthropicAdminClient;
  restore: () => void;
} {
  const originalSync = (registry as any).anthropicSync;
  const originalAdmin = (registry as any).anthropicAdmin;

  const client = fakeClient ?? new FakeAnthropicAdminClient();

  const fakeSyncService = new AnthropicSyncService(
    client,
    prisma as any,
    new AuditService(),
  );

  (registry as any).anthropicSync = fakeSyncService;
  (registry as any).anthropicAdmin = client;

  return {
    fakeClient: client,
    restore: () => {
      (registry as any).anthropicSync = originalSync;
      (registry as any).anthropicAdmin = originalAdmin;
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
// POST /api/admin/sync/claude — auth enforcement
// ---------------------------------------------------------------------------

describe('POST /api/admin/sync/claude — auth enforcement', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/admin/sync/claude');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as student (non-admin)', async () => {
    const agent = await loginAs('student@example.com', 'student');
    const res = await agent.post('/api/admin/sync/claude');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/sync/claude — admin success
// ---------------------------------------------------------------------------

describe('POST /api/admin/sync/claude — admin success', () => {
  it('returns 200 with SyncReport JSON for an admin user', async () => {
    const { fakeClient, restore } = injectFakeAnthropicSync();
    try {
      // Fake client returns empty org — no workspaces configured, so reconcile
      // will throw when trying to resolve the Students workspace. Configure it.
      fakeClient.configure('listWorkspaces', [{ id: 'ws-1', name: 'Students' }]);

      const agent = await loginAs('admin@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/claude');

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        created: 0,
        linked: 0,
        invitedAccepted: 0,
        removed: 0,
        unmatched: [],
      });
    } finally {
      restore();
    }
  });

  it('returns SyncReport with unmatched emails when org user has no local match', async () => {
    const fakeClient = new FakeAnthropicAdminClient();
    fakeClient.configure('listWorkspaces', [{ id: 'ws-1', name: 'Students' }]);
    fakeClient.configure('listOrgUsers', {
      data: [{ id: 'user-abc', email: 'nolocal@example.com', role: 'user' }],
      nextCursor: undefined,
    });

    const { restore } = injectFakeAnthropicSync(fakeClient);
    try {
      const agent = await loginAs('admin2@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/claude');

      expect(res.status).toBe(200);
      expect(res.body.unmatched).toEqual(['nolocal@example.com']);
    } finally {
      restore();
    }
  });

  it('returns 503 when AnthropicAdminApiError is thrown during reconcile', async () => {
    const { fakeClient, restore } = injectFakeAnthropicSync();
    try {
      // listOrgUsers is called unconditionally on every reconcile.
      fakeClient.configureError(
        'listOrgUsers',
        new AnthropicAdminApiError('Anthropic API unavailable', 'listOrgUsers', 503),
      );

      const agent = await loginAs('admin3@example.com', 'admin');
      const res = await agent.post('/api/admin/sync/claude');

      expect(res.status).toBe(503);
      expect(res.body).toHaveProperty('error');
    } finally {
      restore();
    }
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/anthropic/probe — auth enforcement
// ---------------------------------------------------------------------------

describe('GET /api/admin/anthropic/probe — auth enforcement', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/admin/anthropic/probe');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as student (non-admin)', async () => {
    const agent = await loginAs('student2@example.com', 'student');
    const res = await agent.get('/api/admin/anthropic/probe');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/anthropic/probe — admin success
// ---------------------------------------------------------------------------

describe('GET /api/admin/anthropic/probe — admin success', () => {
  it('returns 200 with ok:true when all API calls succeed', async () => {
    const fakeClient = new FakeAnthropicAdminClient();
    fakeClient.configure('listOrgUsers', {
      data: [{ id: 'u1', email: 'user@example.com', role: 'user' }],
      nextCursor: undefined,
    });
    fakeClient.configure('listWorkspaces', [
      { id: 'ws-1', name: 'Students' },
      { id: 'ws-2', name: 'Staff' },
    ]);
    fakeClient.configure('listInvites', {
      data: [{ id: 'inv-1', email: 'invite@example.com', role: 'user', status: 'pending' }],
      nextCursor: undefined,
    });

    const { restore } = injectFakeAnthropicSync(fakeClient);
    try {
      const agent = await loginAs('admin4@example.com', 'admin');
      const res = await agent.get('/api/admin/anthropic/probe');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(true);
      expect(res.body.userCount).toBe(1);
      expect(res.body.workspaces).toEqual(['Students', 'Staff']);
      expect(res.body.invitesCount).toBe(1);
      expect(typeof res.body.writeEnabled).toBe('boolean');
    } finally {
      restore();
    }
  });

  it('returns 200 with ok:false when listOrgUsers throws', async () => {
    const fakeClient = new FakeAnthropicAdminClient();
    fakeClient.configureError(
      'listOrgUsers',
      new AnthropicAdminApiError('Unauthorized', 'listOrgUsers', 401),
    );

    const { restore } = injectFakeAnthropicSync(fakeClient);
    try {
      const agent = await loginAs('admin5@example.com', 'admin');
      const res = await agent.get('/api/admin/anthropic/probe');

      expect(res.status).toBe(200);
      expect(res.body.ok).toBe(false);
      expect(res.body).toHaveProperty('error');
    } finally {
      restore();
    }
  });

  it('returns 200 with empty workspaces array when listWorkspaces returns none', async () => {
    const { restore } = injectFakeAnthropicSync();
    try {
      const agent = await loginAs('admin6@example.com', 'admin');
      const res = await agent.get('/api/admin/anthropic/probe');

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.workspaces)).toBe(true);
      expect(res.body.workspaces).toEqual([]);
    } finally {
      restore();
    }
  });

  it('returns writeEnabled:true when CLAUDE_TEAM_WRITE_ENABLED=1', async () => {
    const saved = process.env.CLAUDE_TEAM_WRITE_ENABLED;
    process.env.CLAUDE_TEAM_WRITE_ENABLED = '1';

    const { restore } = injectFakeAnthropicSync();
    try {
      const agent = await loginAs('admin7@example.com', 'admin');
      const res = await agent.get('/api/admin/anthropic/probe');

      expect(res.status).toBe(200);
      expect(res.body.writeEnabled).toBe(true);
    } finally {
      restore();
      if (saved !== undefined) {
        process.env.CLAUDE_TEAM_WRITE_ENABLED = saved;
      } else {
        delete process.env.CLAUDE_TEAM_WRITE_ENABLED;
      }
    }
  });

  it('returns writeEnabled:false when CLAUDE_TEAM_WRITE_ENABLED is unset', async () => {
    const saved = process.env.CLAUDE_TEAM_WRITE_ENABLED;
    delete process.env.CLAUDE_TEAM_WRITE_ENABLED;

    const { restore } = injectFakeAnthropicSync();
    try {
      const agent = await loginAs('admin8@example.com', 'admin');
      const res = await agent.get('/api/admin/anthropic/probe');

      expect(res.status).toBe(200);
      expect(res.body.writeEnabled).toBe(false);
    } finally {
      restore();
      if (saved !== undefined) {
        process.env.CLAUDE_TEAM_WRITE_ENABLED = saved;
      }
    }
  });
});
