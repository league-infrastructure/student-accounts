/**
 * Integration tests for GET /api/staff/directory (Sprint 009 T004).
 *
 * Covers:
 *  1. Staff user receives 200 with the active student listing.
 *  2. Admin user is blocked — 403 (staff-only route).
 *  3. Student user is blocked — 403.
 *  4. Unauthenticated request is blocked — 401.
 *  5. Response shape: id, displayName, email, cohort, externalAccountTypes.
 *  6. Inactive students are excluded.
 *  7. Non-student active users (staff, admin) are excluded from the list.
 *  8. POST /api/staff/directory returns 404 (no write endpoints).
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import {
  makeCohort,
  makeUser,
  makeExternalAccount,
} from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../server/src/app.js';

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
  role: 'student' | 'staff' | 'admin' = 'student',
  displayName?: string,
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role, displayName });
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

// ---------------------------------------------------------------------------
// Test 1: Staff user receives 200 with student list
// ---------------------------------------------------------------------------

describe('GET /api/staff/directory — staff user', () => {
  it('returns 200 with the active student list for a staff user', async () => {
    const cohort = await makeCohort({ name: 'Spring 2025' });
    const student = await makeUser({
      primary_email: 'student-dir@example.com',
      display_name: 'Directory Student',
      role: 'student',
      cohort_id: cohort.id,
    });
    await makeExternalAccount(student, { type: 'workspace', status: 'active' });

    await makeUser({ primary_email: 'staff-actor@example.com', role: 'staff' });
    const agent = await loginAs('staff-actor@example.com', 'staff');

    const res = await agent.get('/api/staff/directory');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const entry = res.body.find((u: any) => u.email === 'student-dir@example.com');
    expect(entry).toBeDefined();
    expect(entry).toMatchObject({
      id: student.id,
      displayName: 'Directory Student',
      email: 'student-dir@example.com',
      cohort: { id: cohort.id, name: 'Spring 2025' },
    });
    expect(entry.externalAccountTypes).toContain('workspace');
  });
});

// ---------------------------------------------------------------------------
// Test 2: Admin user is blocked — 403
// ---------------------------------------------------------------------------

describe('GET /api/staff/directory — admin user', () => {
  it('returns 403 for a user with role=admin', async () => {
    await makeUser({ primary_email: 'admin-dir@example.com', role: 'admin' });
    const agent = await loginAs('admin-dir@example.com', 'admin');
    const res = await agent.get('/api/staff/directory');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Test 3: Student user is blocked — 403
// ---------------------------------------------------------------------------

describe('GET /api/staff/directory — student user', () => {
  it('returns 403 for a user with role=student', async () => {
    await makeUser({ primary_email: 'student-blocked@example.com', role: 'student' });
    const agent = await loginAs('student-blocked@example.com', 'student');
    const res = await agent.get('/api/staff/directory');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Test 4: Unauthenticated request — 401
// ---------------------------------------------------------------------------

describe('GET /api/staff/directory — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).get('/api/staff/directory');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Test 5: Response shape — cohort null, externalAccountTypes deduplication
// ---------------------------------------------------------------------------

describe('GET /api/staff/directory — response shape', () => {
  it('returns cohort as null when student has no cohort assignment', async () => {
    await makeUser({ primary_email: 'staff-shape@example.com', role: 'staff' });
    const student = await makeUser({
      primary_email: 'nocohort-dir@example.com',
      role: 'student',
      cohort_id: null,
    });

    const agent = await loginAs('staff-shape@example.com', 'staff');
    const res = await agent.get('/api/staff/directory');

    expect(res.status).toBe(200);
    const entry = res.body.find((u: any) => u.id === student.id);
    expect(entry).toBeDefined();
    expect(entry.cohort).toBeNull();
    expect(entry.externalAccountTypes).toEqual([]);
  });

  it('deduplicates externalAccountTypes', async () => {
    await makeUser({ primary_email: 'staff-dedup@example.com', role: 'staff' });
    const student = await makeUser({
      primary_email: 'dedup-dir@example.com',
      role: 'student',
    });
    // Two workspace accounts (e.g. one active, one pending) — should appear once
    await makeExternalAccount(student, { type: 'workspace', status: 'active' });
    await makeExternalAccount(student, { type: 'workspace', status: 'pending' });

    const agent = await loginAs('staff-dedup@example.com', 'staff');
    const res = await agent.get('/api/staff/directory');

    expect(res.status).toBe(200);
    const entry = res.body.find((u: any) => u.id === student.id);
    expect(entry).toBeDefined();
    expect(entry.externalAccountTypes).toEqual(['workspace']);
  });
});

// ---------------------------------------------------------------------------
// Test 6: Inactive students are excluded
// ---------------------------------------------------------------------------

describe('GET /api/staff/directory — inactive students excluded', () => {
  it('does not include students with is_active=false', async () => {
    await makeUser({ primary_email: 'staff-inactive@example.com', role: 'staff' });

    // Create an inactive student directly via prisma
    const inactiveStudent = await (prisma as any).user.create({
      data: {
        display_name: 'Inactive Student',
        primary_email: 'inactive-student@example.com',
        role: 'student',
        created_via: 'admin_created',
        is_active: false,
      },
    });

    const agent = await loginAs('staff-inactive@example.com', 'staff');
    const res = await agent.get('/api/staff/directory');

    expect(res.status).toBe(200);
    const found = res.body.find((u: any) => u.id === inactiveStudent.id);
    expect(found).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Test 7: Non-student active users excluded from list
// ---------------------------------------------------------------------------

describe('GET /api/staff/directory — only students in list', () => {
  it('excludes staff and admin users from the returned list', async () => {
    const staffUser = await makeUser({ primary_email: 'staff-only@example.com', role: 'staff' });
    const adminUser = await makeUser({ primary_email: 'admin-only@example.com', role: 'admin' });
    const student = await makeUser({ primary_email: 'student-only@example.com', role: 'student' });

    const agent = await loginAs('staff-only@example.com', 'staff');
    const res = await agent.get('/api/staff/directory');

    expect(res.status).toBe(200);

    const ids = res.body.map((u: any) => u.id);
    expect(ids).toContain(student.id);
    expect(ids).not.toContain(staffUser.id);
    expect(ids).not.toContain(adminUser.id);
  });
});

// ---------------------------------------------------------------------------
// Test 8: POST returns 404 (no write endpoints on staffDirectoryRouter)
// ---------------------------------------------------------------------------

describe('POST /api/staff/directory — no write endpoints', () => {
  it('returns 404 for a POST request to the directory route', async () => {
    await makeUser({ primary_email: 'staff-post@example.com', role: 'staff' });
    const agent = await loginAs('staff-post@example.com', 'staff');

    const res = await agent.post('/api/staff/directory').send({});
    expect(res.status).toBe(404);
  });
});
