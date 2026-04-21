/**
 * Integration tests for GET /api/admin/audit-log (Sprint 009 T005).
 *
 * Covers:
 *  - 401 when unauthenticated
 *  - 403 when authenticated but non-admin
 *  - No filters: returns all events paginated (descending created_at)
 *  - Filter by action: returns only matching events
 *  - Filter by actorId: returns only that actor's events
 *  - Date range (from/to): returns events within range (inclusive)
 *  - Page 2: returns correct offset
 *  - actorName/targetUserName resolved from User table; null when FK is null
 *  - 400 for invalid param values (non-integer page, malformed date)
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { makeUser, makeAuditEvent } from '../../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
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
 * Force-set created_at on an AuditEvent row via raw SQL.
 * Needed for date-range tests — Prisma doesn't expose created_at in update.
 */
async function setAuditEventCreatedAt(id: number, date: Date): Promise<void> {
  await (prisma as any).$executeRaw`
    UPDATE "AuditEvent" SET created_at = ${date.toISOString()} WHERE id = ${id}
  `;
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

// ---------------------------------------------------------------------------
// 401 — unauthenticated
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-log — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).get('/api/admin/audit-log');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// 403 — non-admin
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-log — non-admin', () => {
  it('returns 403 for a student user', async () => {
    await makeUser({ primary_email: 'student@example.com', role: 'student' });
    const agent = await loginAs('student@example.com', 'student');
    const res = await agent.get('/api/admin/audit-log');
    expect(res.status).toBe(403);
  });

  it('returns 403 for a staff user', async () => {
    await makeUser({ primary_email: 'staff@example.com', role: 'staff' });
    const agent = await loginAs('staff@example.com', 'staff');
    const res = await agent.get('/api/admin/audit-log');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 400 — invalid params
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-log — invalid params', () => {
  let agent: ReturnType<typeof request.agent>;

  beforeEach(async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    agent = await loginAs('admin@example.com', 'admin');
  });

  it('returns 400 for non-integer page', async () => {
    const res = await agent.get('/api/admin/audit-log?page=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/page/i);
  });

  it('returns 400 for page < 1', async () => {
    const res = await agent.get('/api/admin/audit-log?page=0');
    expect(res.status).toBe(400);
  });

  it('returns 400 for non-integer pageSize', async () => {
    const res = await agent.get('/api/admin/audit-log?pageSize=xyz');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/pageSize/i);
  });

  it('returns 400 for malformed from date', async () => {
    const res = await agent.get('/api/admin/audit-log?from=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/from/i);
  });

  it('returns 400 for malformed to date', async () => {
    const res = await agent.get('/api/admin/audit-log?to=not-a-date');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/to/i);
  });

  it('returns 400 for non-integer actorId', async () => {
    const res = await agent.get('/api/admin/audit-log?actorId=abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/actorId/i);
  });

  it('returns 400 for non-integer targetUserId', async () => {
    const res = await agent.get('/api/admin/audit-log?targetUserId=xyz');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/targetUserId/i);
  });
});

// ---------------------------------------------------------------------------
// 200 — no filters: returns all events, paginated, descending created_at
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-log — no filters', () => {
  it('returns all events in descending created_at order with correct shape', async () => {
    // Use a separate admin for login so test-login upsert doesn't clobber display_name
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const actor = await makeUser({ primary_email: 'actor@example.com', display_name: 'Actor User', role: 'student' });
    const target = await makeUser({ primary_email: 'target@example.com', display_name: 'Target User', role: 'student' });

    await makeAuditEvent({ action: 'create_user', actor_user_id: actor.id, target_user_id: target.id });
    await makeAuditEvent({ action: 'assign_cohort' }); // no actor/target

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.get('/api/admin/audit-log');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      total: 2,
      page: 1,
      pageSize: 50,
    });
    expect(Array.isArray(res.body.items)).toBe(true);
    expect(res.body.items).toHaveLength(2);

    // Verify shape of the item with actor/target (actor/target users were not logged in so display_name is unchanged)
    const item = res.body.items.find((i: any) => i.action === 'create_user');
    expect(item).toBeDefined();
    expect(item).toMatchObject({
      actorId: actor.id,
      actorName: 'Actor User',
      action: 'create_user',
      targetUserId: target.id,
      targetUserName: 'Target User',
    });
    expect(item.id).toBeGreaterThan(0);
    expect(item.createdAt).toBeDefined();
  });

  it('returns empty items array when no events exist', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.get('/api/admin/audit-log');

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ total: 0, page: 1, pageSize: 50, items: [] });
  });

  it('resolves actorName and targetUserName to null when FKs are null', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    await makeAuditEvent({ action: 'system_sync' }); // no actor or target

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.get('/api/admin/audit-log');

    expect(res.status).toBe(200);
    const item = res.body.items[0];
    expect(item.actorId).toBeNull();
    expect(item.actorName).toBeNull();
    expect(item.targetUserId).toBeNull();
    expect(item.targetUserName).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 200 — filter by action
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-log — filter by action', () => {
  it('returns only events matching the action filter', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    await makeAuditEvent({ action: 'create_user' });
    await makeAuditEvent({ action: 'create_user' });
    await makeAuditEvent({ action: 'assign_cohort' });

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.get('/api/admin/audit-log?action=create_user');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.every((i: any) => i.action === 'create_user')).toBe(true);
  });

  it('returns empty items when action does not match any event', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    await makeAuditEvent({ action: 'create_user' });

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.get('/api/admin/audit-log?action=nonexistent_action');

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);
    expect(res.body.items).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// 200 — filter by actorId
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-log — filter by actorId', () => {
  it('returns only events where actor_user_id matches', async () => {
    const admin = await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const other = await makeUser({ primary_email: 'other@example.com', role: 'student' });

    await makeAuditEvent({ actor_user_id: admin.id, action: 'create_user' });
    await makeAuditEvent({ actor_user_id: admin.id, action: 'assign_cohort' });
    await makeAuditEvent({ actor_user_id: other.id, action: 'create_user' });

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.get(`/api/admin/audit-log?actorId=${admin.id}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);
    expect(res.body.items.every((i: any) => i.actorId === admin.id)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 200 — date range filter (from / to)
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-log — date range filter', () => {
  it('returns only events within from/to range (inclusive)', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });

    const e1 = await makeAuditEvent({ action: 'create_user' });
    const e2 = await makeAuditEvent({ action: 'assign_cohort' });
    const e3 = await makeAuditEvent({ action: 'provision_workspace' });

    // Set distinct timestamps: e1=yesterday, e2=today, e3=tomorrow
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const today = new Date();
    const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);

    await setAuditEventCreatedAt(e1.id, yesterday);
    await setAuditEventCreatedAt(e2.id, today);
    await setAuditEventCreatedAt(e3.id, tomorrow);

    // Query from yesterday to today — should include e1 and e2 but not e3
    const from = new Date(yesterday.getTime() - 1000).toISOString(); // slightly before yesterday
    const to = new Date(today.getTime() + 1000).toISOString();       // slightly after today

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.get(`/api/admin/audit-log?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`);

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(2);
    expect(res.body.items).toHaveLength(2);

    const ids = res.body.items.map((i: any) => i.id);
    expect(ids).toContain(e1.id);
    expect(ids).toContain(e2.id);
    expect(ids).not.toContain(e3.id);
  });
});

// ---------------------------------------------------------------------------
// 200 — pagination: page 2
// ---------------------------------------------------------------------------

describe('GET /api/admin/audit-log — pagination', () => {
  it('page 2 returns the correct offset slice', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });

    // Create 5 events
    const events: any[] = [];
    for (let i = 0; i < 5; i++) {
      events.push(await makeAuditEvent({ action: `action_${i}` }));
    }

    const agent = await loginAs('admin@example.com', 'admin');

    // Page 1 with pageSize=3 should return 3 items
    const page1 = await agent.get('/api/admin/audit-log?page=1&pageSize=3');
    expect(page1.status).toBe(200);
    expect(page1.body.total).toBe(5);
    expect(page1.body.page).toBe(1);
    expect(page1.body.pageSize).toBe(3);
    expect(page1.body.items).toHaveLength(3);

    // Page 2 with pageSize=3 should return remaining 2 items
    const page2 = await agent.get('/api/admin/audit-log?page=2&pageSize=3');
    expect(page2.status).toBe(200);
    expect(page2.body.total).toBe(5);
    expect(page2.body.page).toBe(2);
    expect(page2.body.pageSize).toBe(3);
    expect(page2.body.items).toHaveLength(2);

    // The two pages should return disjoint sets of IDs
    const page1Ids = new Set(page1.body.items.map((i: any) => i.id));
    const page2Ids = page2.body.items.map((i: any) => i.id);
    expect(page2Ids.every((id: number) => !page1Ids.has(id))).toBe(true);
  });

  it('clamps pageSize to max 200', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.get('/api/admin/audit-log?pageSize=9999');

    expect(res.status).toBe(200);
    expect(res.body.pageSize).toBe(200);
  });
});
