/**
 * Tests for impersonation API endpoints and /api/auth/me impersonation fields.
 *
 *   POST /api/admin/users/:id/impersonate  — start impersonating a user
 *   POST /api/admin/stop-impersonating     — stop impersonation
 *   GET  /api/auth/me                      — returns impersonating + realAdmin fields
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import app from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';

process.env.NODE_ENV = 'test';

// =============================================================================
// Test data
// =============================================================================

let adminId: number;
let targetUserId: number;

beforeAll(async () => {
  const admin = await prisma.user.upsert({
    where: { primary_email: 'imp-route-admin@example.com' },
    update: { role: 'admin' },
    create: {
      primary_email: 'imp-route-admin@example.com',
      display_name: 'Route Admin',
      role: 'admin',
      created_via: 'admin_created',
    },
  });
  adminId = admin.id;

  const target = await prisma.user.upsert({
    where: { primary_email: 'imp-route-target@example.com' },
    update: { role: 'student' },
    create: {
      primary_email: 'imp-route-target@example.com',
      display_name: 'Route Target',
      role: 'student',
      created_via: 'admin_created',
    },
  });
  targetUserId = target.id;
});

afterAll(async () => {
  await prisma.user.deleteMany({
    where: {
      primary_email: {
        in: [
          'imp-route-admin@example.com',
          'imp-route-target@example.com',
        ],
      },
    },
  });
});

// =============================================================================
// Helpers
// =============================================================================

/** Returns a supertest agent logged in as the admin user. */
async function loginAsAdmin() {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email: 'imp-route-admin@example.com',
    displayName: 'Route Admin',
    role: 'ADMIN',
  });
  return agent;
}

/** Returns a supertest agent logged in as the regular target user. */
async function loginAsUser() {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email: 'imp-route-target@example.com',
    displayName: 'Route Target',
    role: 'USER',
  });
  return agent;
}

// =============================================================================
// POST /api/admin/users/:id/impersonate
// =============================================================================

describe('POST /api/admin/users/:id/impersonate', () => {
  it('admin starts impersonating a user — returns 200 and target user shape', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.post(`/api/admin/users/${targetUserId}/impersonate`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.impersonating).toMatchObject({
      id: targetUserId,
      email: 'imp-route-target@example.com',
      role: 'USER',
    });
  });

  it('session has impersonatingUserId set after impersonation starts', async () => {
    const agent = await loginAsAdmin();
    await agent.post(`/api/admin/users/${targetUserId}/impersonate`);

    // GET /me should now reflect the impersonated user
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('imp-route-target@example.com');
    expect(me.body.impersonating).toBe(true);
    expect(me.body.realAdmin).toMatchObject({
      id: adminId,
      displayName: 'Route Admin',
    });
  });

  it('returns 404 when target user does not exist', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.post('/api/admin/users/999999/impersonate');

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for self-impersonation', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.post(`/api/admin/users/${adminId}/impersonate`);

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 for non-integer id', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.post('/api/admin/users/not-a-number/impersonate');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('non-admin user receives 403', async () => {
    const agent = await loginAsUser();
    const res = await agent.post(`/api/admin/users/${adminId}/impersonate`);

    expect(res.status).toBe(403);
  });

  it('unauthenticated request receives 401', async () => {
    const res = await request(app).post(`/api/admin/users/${targetUserId}/impersonate`);
    expect(res.status).toBe(401);
  });
});

// =============================================================================
// GET /api/auth/me — impersonation fields
// =============================================================================

describe('GET /api/auth/me — impersonation fields', () => {
  it('returns impersonating: false and realAdmin: null when not impersonating', async () => {
    const agent = await loginAsAdmin();
    const me = await agent.get('/api/auth/me');

    expect(me.status).toBe(200);
    expect(me.body.impersonating).toBe(false);
    expect(me.body.realAdmin).toBeNull();
  });

  it('returns impersonating: true and realAdmin populated during impersonation', async () => {
    const agent = await loginAsAdmin();
    await agent.post(`/api/admin/users/${targetUserId}/impersonate`);

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.impersonating).toBe(true);
    expect(me.body.realAdmin).not.toBeNull();
    expect(me.body.realAdmin.id).toBe(adminId);
    expect(me.body.realAdmin.displayName).toBe('Route Admin');
    // req.user should now be the target user
    expect(me.body.email).toBe('imp-route-target@example.com');
    expect(me.body.role).toBe('USER');
  });
});

// =============================================================================
// POST /api/admin/stop-impersonating
// =============================================================================

describe('POST /api/admin/stop-impersonating', () => {
  it('admin calls stop-impersonating — returns 200 and session is cleared', async () => {
    const agent = await loginAsAdmin();
    // Start impersonating
    await agent.post(`/api/admin/users/${targetUserId}/impersonate`);

    // Stop impersonating
    const stopRes = await agent.post('/api/admin/stop-impersonating');
    expect(stopRes.status).toBe(200);
    expect(stopRes.body.ok).toBe(true);
  });

  it('after stopping, /me returns impersonating: false and the real admin identity', async () => {
    const agent = await loginAsAdmin();
    await agent.post(`/api/admin/users/${targetUserId}/impersonate`);
    await agent.post('/api/admin/stop-impersonating');

    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.impersonating).toBe(false);
    expect(me.body.realAdmin).toBeNull();
    expect(me.body.email).toBe('imp-route-admin@example.com');
  });

  it('calling stop-impersonating when not impersonating returns 400', async () => {
    const agent = await loginAsAdmin();
    const res = await agent.post('/api/admin/stop-impersonating');

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error', 'Not impersonating');
  });

  it('unauthenticated stop-impersonating returns 401', async () => {
    const res = await request(app).post('/api/admin/stop-impersonating');
    expect(res.status).toBe(401);
  });
});
