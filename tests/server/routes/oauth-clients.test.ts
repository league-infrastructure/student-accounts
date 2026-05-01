/**
 * Integration tests for OAuth client CRUD routes (Sprint 020 T002).
 *
 * Routes moved from /api/admin/oauth-clients → /api/oauth-clients.
 * Now accessible to all authenticated users; ownership-filtered for non-admins.
 *
 * GET    /api/oauth-clients
 * POST   /api/oauth-clients
 * PATCH  /api/oauth-clients/:id
 * POST   /api/oauth-clients/:id/rotate-secret
 * DELETE /api/oauth-clients/:id
 * Compat: GET/POST/PATCH/DELETE /api/admin/oauth-clients[/...] → 308
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../../server/src/app.js';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser } from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function wipe() {
  await (prisma as any).oAuthAccessToken.deleteMany();
  await (prisma as any).oAuthClient.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

beforeEach(wipe);
afterEach(wipe);

async function loginAs(email: string, role: 'student' | 'staff' | 'admin' = 'student') {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
}

async function asAdmin() {
  const user = await makeUser({ role: 'admin', primary_email: 'admin@test.com' });
  const agent = await loginAs('admin@test.com', 'admin');
  return { agent, user };
}

async function asStudent(email = 'student@test.com') {
  const user = await makeUser({ role: 'student', primary_email: email });
  const agent = await loginAs(email, 'student');
  return { agent, user };
}

async function asStaff(email = 'staff@test.com') {
  const user = await makeUser({ role: 'staff', primary_email: email });
  const agent = await loginAs(email, 'staff');
  return { agent, user };
}

// ---------------------------------------------------------------------------
// GET /api/oauth-clients — list (ownership-filtered)
// ---------------------------------------------------------------------------

describe('GET /api/oauth-clients', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/oauth-clients');
    expect(res.status).toBe(401);
  });

  it('student: lists only own clients', async () => {
    const { agent, user } = await asStudent('owner@test.com');
    const other = await makeUser({ role: 'student', primary_email: 'other@test.com' });

    await registry.oauthClients.create({ name: 'Mine', redirect_uris: [], allowed_scopes: [] }, user.id);
    await registry.oauthClients.create({ name: 'Theirs', redirect_uris: [], allowed_scopes: [] }, other.id);

    const res = await agent.get('/api/oauth-clients');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('Mine');
  });

  it('staff: lists only own clients', async () => {
    const { agent, user } = await asStaff('staffowner@test.com');
    const other = await makeUser({ role: 'student', primary_email: 'other2@test.com' });

    await registry.oauthClients.create({ name: 'StaffMine', redirect_uris: [], allowed_scopes: [] }, user.id);
    await registry.oauthClients.create({ name: 'StudentOther', redirect_uris: [], allowed_scopes: [] }, other.id);

    const res = await agent.get('/api/oauth-clients');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('StaffMine');
  });

  it('admin: returns all clients regardless of owner', async () => {
    const { agent } = await asAdmin();
    const student = await makeUser({ role: 'student', primary_email: 'student2@test.com' });
    const adminUser = await makeUser({ role: 'admin', primary_email: 'admin2@test.com' });

    await registry.oauthClients.create({ name: 'StudentApp', redirect_uris: [], allowed_scopes: [] }, student.id);
    await registry.oauthClients.create({ name: 'AdminApp', redirect_uris: [], allowed_scopes: [] }, adminUser.id);

    const res = await agent.get('/api/oauth-clients');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const names = res.body.map((c: any) => c.name);
    expect(names).toContain('StudentApp');
    expect(names).toContain('AdminApp');
  });

  it('returns clients without client_secret_hash', async () => {
    const { agent, user } = await asStudent('nosecret@test.com');
    await registry.oauthClients.create({ name: 'TestApp', redirect_uris: [], allowed_scopes: ['users:read'] }, user.id);

    const res = await agent.get('/api/oauth-clients');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const client of res.body) {
      expect(client).not.toHaveProperty('client_secret_hash');
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/oauth-clients — create
// ---------------------------------------------------------------------------

describe('POST /api/oauth-clients', () => {
  it('creates a client and returns plaintext secret once', async () => {
    const { agent } = await asStudent('creator@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'NewApp',
      description: 'Test',
      redirect_uris: ['https://example.com'],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('client');
    expect(res.body).toHaveProperty('client_secret');
    expect(res.body.client_secret).toMatch(/^oacs_/);
    expect(res.body.client).not.toHaveProperty('client_secret_hash');
    expect(res.body.client.name).toBe('NewApp');
  });

  it('returns 400 for missing name', async () => {
    const { agent } = await asStudent('bad@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      redirect_uris: [],
      allowed_scopes: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 if redirect_uris is not an array', async () => {
    const { agent } = await asStudent('bad2@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'Bad',
      redirect_uris: 'not-array',
      allowed_scopes: [],
    });
    expect(res.status).toBe(400);
  });

  it('writes an oauth_client_created audit event', async () => {
    const { agent } = await asStudent('auditor@test.com');
    await agent.post('/api/oauth-clients').send({
      name: 'AuditApp',
      redirect_uris: [],
      allowed_scopes: [],
    });
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_created' } });
    expect(events.length).toBeGreaterThan(0);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).post('/api/oauth-clients').send({
      name: 'Fail',
      redirect_uris: [],
      allowed_scopes: [],
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/oauth-clients/:id — update (ownership-gated)
// ---------------------------------------------------------------------------

describe('PATCH /api/oauth-clients/:id', () => {
  it('owner: can update own client', async () => {
    const { agent, user } = await asStudent('owner-patch@test.com');
    const { client } = await registry.oauthClients.create({ name: 'Old', redirect_uris: [], allowed_scopes: [] }, user.id);

    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({ name: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body).not.toHaveProperty('client_secret_hash');
  });

  it('non-owner non-admin: gets 403', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'owner-real@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'Owned', redirect_uris: [], allowed_scopes: [] }, owner.id);

    const { agent } = await asStudent('intruder@test.com');
    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('admin: can update someone else\'s client', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'student-owned@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'StudentApp', redirect_uris: [], allowed_scopes: [] }, owner.id);

    const { agent } = await asAdmin();
    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({ name: 'AdminUpdated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('AdminUpdated');
  });

  it('rejects non-array redirect_uris', async () => {
    const { agent, user } = await asStudent('patcher2@test.com');
    const { client } = await registry.oauthClients.create({ name: 'P', redirect_uris: [], allowed_scopes: [] }, user.id);

    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({ redirect_uris: 'invalid' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/oauth-clients/:id/rotate-secret — rotate (ownership-gated)
// ---------------------------------------------------------------------------

describe('POST /api/oauth-clients/:id/rotate-secret', () => {
  it('owner: can rotate secret', async () => {
    const { agent, user } = await asStudent('rotator@test.com');
    const { client, plaintextSecret: original } = await registry.oauthClients.create(
      { name: 'RotateMe', redirect_uris: [], allowed_scopes: [] },
      user.id,
    );

    const res = await agent.post(`/api/oauth-clients/${client.id}/rotate-secret`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('client_secret');
    expect(res.body.client_secret).toMatch(/^oacs_/);
    expect(res.body.client_secret).not.toBe(original);
  });

  it('non-owner non-admin: gets 403', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'rotate-owner@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'RotateMe2', redirect_uris: [], allowed_scopes: [] }, owner.id);

    const { agent } = await asStudent('rotate-intruder@test.com');
    const res = await agent.post(`/api/oauth-clients/${client.id}/rotate-secret`);
    expect(res.status).toBe(403);
  });

  it('writes an oauth_client_secret_rotated audit event', async () => {
    const { agent, user } = await asStudent('rotator2@test.com');
    const { client } = await registry.oauthClients.create({ name: 'RA', redirect_uris: [], allowed_scopes: [] }, user.id);

    await agent.post(`/api/oauth-clients/${client.id}/rotate-secret`);
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_secret_rotated' } });
    expect(events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/oauth-clients/:id — soft delete (ownership-gated)
// ---------------------------------------------------------------------------

describe('DELETE /api/oauth-clients/:id', () => {
  it('owner: soft-deletes (sets disabled_at) and returns 204', async () => {
    const { agent, user } = await asStudent('deleter@test.com');
    const { client } = await registry.oauthClients.create({ name: 'Del', redirect_uris: [], allowed_scopes: [] }, user.id);

    const res = await agent.delete(`/api/oauth-clients/${client.id}`);
    expect(res.status).toBe(204);

    const raw = await (prisma as any).oAuthClient.findUnique({ where: { id: client.id } });
    expect(raw).not.toBeNull();
    expect(raw.disabled_at).not.toBeNull();
  });

  it('non-owner non-admin: gets 403', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'delete-owner@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'Protected', redirect_uris: [], allowed_scopes: [] }, owner.id);

    const { agent } = await asStudent('delete-intruder@test.com');
    const res = await agent.delete(`/api/oauth-clients/${client.id}`);
    expect(res.status).toBe(403);
  });

  it('admin: can delete someone else\'s client', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'admin-delete-target@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'AdminDel', redirect_uris: [], allowed_scopes: [] }, owner.id);

    const { agent } = await asAdmin();
    const res = await agent.delete(`/api/oauth-clients/${client.id}`);
    expect(res.status).toBe(204);
  });

  it('writes an oauth_client_disabled audit event', async () => {
    const { agent, user } = await asStudent('deleter2@test.com');
    const { client } = await registry.oauthClients.create({ name: 'DA', redirect_uris: [], allowed_scopes: [] }, user.id);

    await agent.delete(`/api/oauth-clients/${client.id}`);
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_disabled' } });
    expect(events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Compat redirect — /api/admin/oauth-clients → /api/oauth-clients (308)
// ---------------------------------------------------------------------------

describe('Compat redirect /api/admin/oauth-clients → /api/oauth-clients', () => {
  it('GET /api/admin/oauth-clients → 308 to /api/oauth-clients', async () => {
    const { agent } = await asStudent('compat1@test.com');
    const res = await agent.get('/api/admin/oauth-clients').redirects(0);
    expect(res.status).toBe(308);
    expect(res.headers['location']).toBe('/api/oauth-clients');
  });

  it('unauthenticated GET /api/admin/oauth-clients → 401 (not a redirect)', async () => {
    const res = await request(app).get('/api/admin/oauth-clients').redirects(0);
    expect(res.status).toBe(401);
  });

  it('PATCH /api/admin/oauth-clients/:id → 308 to /api/oauth-clients/:id', async () => {
    const { agent } = await asStudent('compat2@test.com');
    const res = await agent.patch('/api/admin/oauth-clients/42').send({ name: 'test' }).redirects(0);
    expect(res.status).toBe(308);
    expect(res.headers['location']).toBe('/api/oauth-clients/42');
  });

  it('GET /api/admin/oauth-clients?foo=bar → 308 preserving query string', async () => {
    const { agent } = await asStudent('compat3@test.com');
    const res = await agent.get('/api/admin/oauth-clients?foo=bar').redirects(0);
    expect(res.status).toBe(308);
    expect(res.headers['location']).toBe('/api/oauth-clients?foo=bar');
  });

  it('following the 308 redirect from PATCH reaches the real endpoint', async () => {
    const { agent, user } = await asStudent('compat-follow@test.com');
    const { client } = await registry.oauthClients.create({ name: 'CompatTarget', redirect_uris: [], allowed_scopes: [] }, user.id);

    // Explicitly follow up to 1 redirect. Supertest does not auto-follow
    // 308 on non-GET methods by default.
    const res = await agent
      .patch(`/api/admin/oauth-clients/${client.id}`)
      .send({ name: 'CompatUpdated' })
      .redirects(1);
    // After following 308, PATCH lands on /api/oauth-clients/:id
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('CompatUpdated');
  });
});
