/**
 * Integration tests for GET /api/admin/stats (Sprint 010 T003).
 *
 * Covers:
 *  - 401 when not authenticated
 *  - 403 when authenticated as a non-admin (student)
 *  - 200 with correct shape and aggregate counts against seeded data
 *  - 200 returns zero counts on an empty database
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import {
  makeUser,
  makeCohort,
  makeProvisioningRequest,
  makeMergeSuggestion,
} from '../../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../../server/src/app.js';

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

async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
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
// Auth enforcement — unauthenticated
// ---------------------------------------------------------------------------

describe('GET /api/admin/stats — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).get('/api/admin/stats');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Auth enforcement — non-admin
// ---------------------------------------------------------------------------

describe('GET /api/admin/stats — non-admin', () => {
  it('returns 403 for a student user', async () => {
    const agent = await loginAs('student-stats@example.com', 'student');
    const res = await agent.get('/api/admin/stats');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// 200 — empty database
// ---------------------------------------------------------------------------

describe('GET /api/admin/stats — empty database', () => {
  it('returns 200 with all zeros when no domain data exists', async () => {
    const agent = await loginAs('admin-stats-empty@example.com', 'admin');
    const res = await agent.get('/api/admin/stats');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      totalStudents: 0,
      totalStaff: 0,
      totalAdmins: 1,   // the admin we created via test-login
      pendingRequests: 0,
      openMergeSuggestions: 0,
      cohortCount: 0,
    });
  });
});

// ---------------------------------------------------------------------------
// 200 — correct counts against seeded data
// ---------------------------------------------------------------------------

describe('GET /api/admin/stats — seeded data', () => {
  it('returns correct aggregate counts', async () => {
    // Seed: 3 students (2 active, 1 inactive), 1 staff, 1 admin (seeded below)
    // plus the admin created by loginAs — total active admins = 2
    const student1 = await makeUser({ primary_email: 'stats-s1@example.com', role: 'student' });
    const student2 = await makeUser({ primary_email: 'stats-s2@example.com', role: 'student' });
    // Inactive student — should NOT be counted
    await (prisma as any).user.create({
      data: {
        primary_email: 'stats-inactive@example.com',
        display_name: 'Inactive Student',
        role: 'student',
        created_via: 'admin_created',
        is_active: false,
      },
    });
    const staffUser = await makeUser({ primary_email: 'stats-staff@example.com', role: 'staff' });

    // 2 pending provisioning requests
    await makeProvisioningRequest(student1, { status: 'pending' });
    await makeProvisioningRequest(student2, { status: 'pending' });
    // 1 approved provisioning request — should NOT be counted
    await makeProvisioningRequest(staffUser, { status: 'approved' });

    // 1 pending merge suggestion
    await makeMergeSuggestion(student1, student2, { status: 'pending' });
    // 1 rejected merge suggestion — should NOT be counted
    const student3 = await makeUser({ primary_email: 'stats-s3@example.com', role: 'student' });
    await makeMergeSuggestion(student1, student3, { status: 'rejected' });

    // 2 cohorts
    await makeCohort({ name: 'Cohort Alpha' });
    await makeCohort({ name: 'Cohort Beta' });

    const agent = await loginAs('admin-stats-seeded@example.com', 'admin');
    const res = await agent.get('/api/admin/stats');

    expect(res.status).toBe(200);

    // 3 active students (s1, s2, s3 — inactive one excluded)
    expect(res.body.totalStudents).toBe(3);
    // 1 staff
    expect(res.body.totalStaff).toBe(1);
    // 1 admin (the one created by loginAs via test-login)
    expect(res.body.totalAdmins).toBe(1);
    // 2 pending provisioning requests
    expect(res.body.pendingRequests).toBe(2);
    // 1 pending merge suggestion
    expect(res.body.openMergeSuggestions).toBe(1);
    // 2 cohorts
    expect(res.body.cohortCount).toBe(2);

    // Response shape: all keys present and are numbers
    const keys = ['totalStudents', 'totalStaff', 'totalAdmins', 'pendingRequests', 'openMergeSuggestions', 'cohortCount'];
    for (const key of keys) {
      expect(typeof res.body[key]).toBe('number');
    }
  });
});
