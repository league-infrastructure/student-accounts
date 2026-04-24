/**
 * Integration tests for POST /api/admin/cohorts/:id/sync-to-group.
 *
 * The endpoint copies a cohort's active students into a Group whose name
 * matches the cohort's. It creates the group if missing and is
 * idempotent (only adds users who aren't already members).
 *
 * Covers:
 *  - 401 unauthenticated, 403 non-admin, 400 bad id, 404 missing cohort
 *  - 200 success: creates the group the first time, reuses it the second
 *  - Idempotency: second call adds nothing and reports 0 added
 *  - Scope: only active students are copied; staff / admins / inactive
 *    users are excluded even when they share the cohort_id
 *  - Audit trail: create_group + add_group_member rows written inside
 *    the same transaction
 */

import request from 'supertest';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeCohort, makeUser, makeGroup, makeMembership } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
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

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('POST /api/admin/cohorts/:id/sync-to-group — auth', () => {
  it('returns 401 when not authenticated', async () => {
    const cohort = await makeCohort();
    const res = await request(app).post(`/api/admin/cohorts/${cohort.id}/sync-to-group`);
    expect(res.status).toBe(401);
  });

  it('returns 403 for non-admin users', async () => {
    const cohort = await makeCohort();
    await makeUser({ primary_email: 'student@example.com', role: 'student' });
    const agent = await loginAs('student@example.com', 'student');
    const res = await agent.post(`/api/admin/cohorts/${cohort.id}/sync-to-group`);
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Input validation
// ---------------------------------------------------------------------------

describe('POST /api/admin/cohorts/:id/sync-to-group — validation', () => {
  it('returns 400 for a non-numeric id', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.post('/api/admin/cohorts/abc/sync-to-group');
    expect(res.status).toBe(400);
  });

  it('returns 404 when the cohort does not exist', async () => {
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.post('/api/admin/cohorts/999999/sync-to-group');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('POST /api/admin/cohorts/:id/sync-to-group — success', () => {
  it('creates a new group named after the cohort and copies all active students', async () => {
    const cohort = await makeCohort({ name: 'Spring 2026', google_ou_path: '/Students/Spring2026' });
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const alice = await makeUser({ primary_email: 'alice@example.com', role: 'student', cohort_id: cohort.id });
    const bob = await makeUser({ primary_email: 'bob@example.com', role: 'student', cohort_id: cohort.id });

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.post(`/api/admin/cohorts/${cohort.id}/sync-to-group`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      groupName: 'Spring 2026',
      created: true,
      addedCount: 2,
      alreadyMemberCount: 0,
      eligibleCount: 2,
    });
    expect(typeof res.body.groupId).toBe('number');

    // Group was actually created
    const group = await (prisma as any).group.findUnique({ where: { id: res.body.groupId } });
    expect(group).not.toBeNull();
    expect(group.name).toBe('Spring 2026');

    // Both students are members
    const memberships = await (prisma as any).userGroup.findMany({
      where: { group_id: group.id },
      orderBy: { user_id: 'asc' },
    });
    expect(memberships.map((m: any) => m.user_id).sort()).toEqual([alice.id, bob.id].sort());

    // Audit events written
    const events = await (prisma as any).auditEvent.findMany({
      where: { target_entity_type: 'Group', target_entity_id: String(group.id) },
    });
    const actions = events.map((e: any) => e.action).sort();
    expect(actions).toEqual(['add_group_member', 'add_group_member', 'create_group']);
  });

  it('reuses an existing group with the same name and only adds new members', async () => {
    const cohort = await makeCohort({ name: 'Existing Class' });
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    const alice = await makeUser({ primary_email: 'alice@example.com', role: 'student', cohort_id: cohort.id });
    const bob = await makeUser({ primary_email: 'bob@example.com', role: 'student', cohort_id: cohort.id });

    // Group already exists with alice in it.
    const existingGroup = await makeGroup({ name: 'Existing Class' });
    await makeMembership(existingGroup, alice);

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.post(`/api/admin/cohorts/${cohort.id}/sync-to-group`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      groupId: existingGroup.id,
      groupName: 'Existing Class',
      created: false,
      addedCount: 1,
      alreadyMemberCount: 1,
      eligibleCount: 2,
    });

    const memberships = await (prisma as any).userGroup.findMany({
      where: { group_id: existingGroup.id },
    });
    expect(memberships.map((m: any) => m.user_id).sort()).toEqual([alice.id, bob.id].sort());
  });

  it('is idempotent — calling twice adds zero new members the second time', async () => {
    const cohort = await makeCohort({ name: 'Idempotent Class' });
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });
    await makeUser({ primary_email: 'alice@example.com', role: 'student', cohort_id: cohort.id });
    await makeUser({ primary_email: 'bob@example.com', role: 'student', cohort_id: cohort.id });

    const agent = await loginAs('admin@example.com', 'admin');
    const first = await agent.post(`/api/admin/cohorts/${cohort.id}/sync-to-group`);
    expect(first.status).toBe(200);
    expect(first.body.addedCount).toBe(2);
    expect(first.body.created).toBe(true);

    const second = await agent.post(`/api/admin/cohorts/${cohort.id}/sync-to-group`);
    expect(second.status).toBe(200);
    expect(second.body.addedCount).toBe(0);
    expect(second.body.alreadyMemberCount).toBe(2);
    expect(second.body.created).toBe(false);
    expect(second.body.groupId).toBe(first.body.groupId);
  });

  it('excludes staff, admins, and inactive users from the sync', async () => {
    const cohort = await makeCohort({ name: 'Mixed Cohort' });
    await makeUser({ primary_email: 'admin@example.com', role: 'admin' });

    const activeStudent = await makeUser({
      primary_email: 'active@example.com',
      role: 'student',
      cohort_id: cohort.id,
    });
    // Staff shouldn't be synced even if cohort_id is set
    await makeUser({
      primary_email: 'staff@example.com',
      role: 'staff',
      cohort_id: cohort.id,
    });
    // Admin shouldn't be synced even if cohort_id is set
    await makeUser({
      primary_email: 'coadmin@example.com',
      role: 'admin',
      cohort_id: cohort.id,
    });
    // Inactive student shouldn't be synced
    const inactive = await makeUser({
      primary_email: 'inactive@example.com',
      role: 'student',
      cohort_id: cohort.id,
    });
    await (prisma as any).user.update({ where: { id: inactive.id }, data: { is_active: false } });

    const agent = await loginAs('admin@example.com', 'admin');
    const res = await agent.post(`/api/admin/cohorts/${cohort.id}/sync-to-group`);

    expect(res.status).toBe(200);
    expect(res.body.eligibleCount).toBe(1);
    expect(res.body.addedCount).toBe(1);

    const memberships = await (prisma as any).userGroup.findMany({
      where: { group_id: res.body.groupId },
    });
    expect(memberships.map((m: any) => m.user_id)).toEqual([activeStudent.id]);
  });
});
