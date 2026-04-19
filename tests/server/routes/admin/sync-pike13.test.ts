/**
 * Integration tests for POST /api/admin/sync/pike13 (Sprint 006 T003).
 *
 * Covers:
 *  - 401 when not authenticated
 *  - 403 when authenticated but not admin (student role)
 *  - 200 with SyncReport JSON when authenticated as admin
 *  - SyncReport shape is validated (created, matched, skipped, errors, errorDetails)
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { Pike13SyncService } from '../../../../server/src/services/pike13/pike13-sync.service.js';
import { FakePike13ApiClient } from '../../helpers/fake-pike13-api.client.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { UserRepository } from '../../../../server/src/services/repositories/user.repository.js';
import { ExternalAccountRepository } from '../../../../server/src/services/repositories/external-account.repository.js';

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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await cleanDb();
});

describe('POST /api/admin/sync/pike13 — auth enforcement', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/admin/sync/pike13');
    expect(res.status).toBe(401);
  });

  it('returns 403 when authenticated as student (non-admin)', async () => {
    const agent = await loginAs('student@example.com', 'student');
    const res = await agent.post('/api/admin/sync/pike13');
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/sync/pike13 — admin success', () => {
  it('returns 200 with SyncReport JSON for an admin user', async () => {
    // Inject a FakePike13ApiClient that returns an empty page.
    const fakePike13 = new FakePike13ApiClient();
    const fakeSyncService = new Pike13SyncService(
      fakePike13,
      prisma as any,
      UserRepository,
      ExternalAccountRepository,
      new AuditService(),
      async () => {},
    );
    (registry as any).pike13Sync = fakeSyncService;

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.post('/api/admin/sync/pike13');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      created: 0,
      matched: 0,
      skipped: 0,
      errors: 0,
      errorDetails: [],
    });
  });

  it('returns SyncReport with created count when Pike13 has new people', async () => {
    const fakePike13 = new FakePike13ApiClient();
    fakePike13.configure('listPeople', {
      people: [
        { id: 1001, first_name: 'Zara', last_name: 'Quinn', email: 'zara@example.com' },
      ],
      nextCursor: null,
    });

    const fakeSyncService = new Pike13SyncService(
      fakePike13,
      prisma as any,
      UserRepository,
      ExternalAccountRepository,
      new AuditService(),
      async () => {},
    );
    (registry as any).pike13Sync = fakeSyncService;

    const agent = await loginAs('admin2@example.com', 'admin');
    const res = await agent.post('/api/admin/sync/pike13');

    expect(res.status).toBe(200);
    expect(res.body.created).toBe(1);
    expect(res.body.matched).toBe(0);
    expect(res.body.errors).toBe(0);
  });
});
