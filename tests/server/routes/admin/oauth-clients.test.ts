/**
 * Integration tests for admin OAuth client CRUD routes (Sprint 018 T006).
 *
 * GET    /api/admin/oauth-clients
 * POST   /api/admin/oauth-clients
 * PATCH  /api/admin/oauth-clients/:id
 * POST   /api/admin/oauth-clients/:id/rotate-secret
 * DELETE /api/admin/oauth-clients/:id
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../../../server/src/app.js';
import { prisma } from '../../../../server/src/services/prisma.js';
import { makeUser } from '../../helpers/factories.js';

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

async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
) {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
}

async function asAdmin() {
  const user = await makeUser({ role: 'admin', primary_email: 'admin@test.com' });
  return loginAs('admin@test.com', 'admin');
}

async function asStudent() {
  await makeUser({ role: 'student', primary_email: 'student@test.com' });
  return loginAs('student@test.com', 'student');
}

// ---------------------------------------------------------------------------
// GET /api/admin/oauth-clients
// ---------------------------------------------------------------------------

describe('GET /api/admin/oauth-clients', () => {
  it('returns 403 for non-admin', async () => {
    const agent = await asStudent();
    const res = await agent.get('/api/admin/oauth-clients');
    expect(res.status).toBe(403);
  });

  it('returns empty array when no clients exist', async () => {
    const agent = await asAdmin();
    const res = await agent.get('/api/admin/oauth-clients');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns clients without client_secret_hash', async () => {
    const agent = await asAdmin();
    const actor = await makeUser({ role: 'admin', primary_email: 'actor2@test.com' });
    await registry.oauthClients.create({ name: 'TestApp', redirect_uris: [], allowed_scopes: ['users:read'] }, actor.id);

    const res = await agent.get('/api/admin/oauth-clients');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const client of res.body) {
      expect(client).not.toHaveProperty('client_secret_hash');
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/oauth-clients
// ---------------------------------------------------------------------------

describe('POST /api/admin/oauth-clients', () => {
  it('returns 403 for non-admin', async () => {
    const agent = await asStudent();
    const res = await agent
      .post('/api/admin/oauth-clients')
      .send({ name: 'Fail', redirect_uris: [], allowed_scopes: [] });
    expect(res.status).toBe(403);
  });

  it('creates a client and returns plaintext secret once', async () => {
    const agent = await asAdmin();
    const res = await agent.post('/api/admin/oauth-clients').send({
      name: 'NewApp',
      description: 'Test',
      redirect_uris: ['https://example.com'],
      allowed_scopes: ['users:read'],
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('client');
    expect(res.body).toHaveProperty('client_secret');
    expect(res.body.client_secret).toMatch(/^oacs_/);
    expect(res.body.client).not.toHaveProperty('client_secret_hash');
    expect(res.body.client.name).toBe('NewApp');
  });

  it('returns 400 for missing name', async () => {
    const agent = await asAdmin();
    const res = await agent.post('/api/admin/oauth-clients').send({
      redirect_uris: [],
      allowed_scopes: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 if redirect_uris is not an array', async () => {
    const agent = await asAdmin();
    const res = await agent.post('/api/admin/oauth-clients').send({
      name: 'Bad',
      redirect_uris: 'not-array',
      allowed_scopes: [],
    });
    expect(res.status).toBe(400);
  });

  it('writes an oauth_client_created audit event', async () => {
    const agent = await asAdmin();
    await agent.post('/api/admin/oauth-clients').send({
      name: 'AuditApp',
      redirect_uris: [],
      allowed_scopes: [],
    });
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_created' } });
    expect(events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/oauth-clients/:id
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/oauth-clients/:id', () => {
  it('returns 403 for non-admin', async () => {
    const agent = await asStudent();
    const res = await agent.patch('/api/admin/oauth-clients/1').send({ name: 'Fail' });
    expect(res.status).toBe(403);
  });

  it('updates name and returns sanitized client', async () => {
    const agent = await asAdmin();
    const actor = await makeUser({ role: 'admin', primary_email: 'patcher@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'Old', redirect_uris: [], allowed_scopes: [] }, actor.id);

    const res = await agent.patch(`/api/admin/oauth-clients/${client.id}`).send({ name: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body).not.toHaveProperty('client_secret_hash');
  });

  it('rejects non-array redirect_uris', async () => {
    const agent = await asAdmin();
    const actor = await makeUser({ role: 'admin', primary_email: 'patcher2@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'P', redirect_uris: [], allowed_scopes: [] }, actor.id);

    const res = await agent
      .patch(`/api/admin/oauth-clients/${client.id}`)
      .send({ redirect_uris: 'invalid' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/oauth-clients/:id/rotate-secret
// ---------------------------------------------------------------------------

describe('POST /api/admin/oauth-clients/:id/rotate-secret', () => {
  it('returns 403 for non-admin', async () => {
    const agent = await asStudent();
    const res = await agent.post('/api/admin/oauth-clients/1/rotate-secret');
    expect(res.status).toBe(403);
  });

  it('returns new plaintext secret (only)', async () => {
    const agent = await asAdmin();
    const actor = await makeUser({ role: 'admin', primary_email: 'rotator@test.com' });
    const { client, plaintextSecret: original } = await registry.oauthClients.create(
      { name: 'RotateMe', redirect_uris: [], allowed_scopes: [] },
      actor.id,
    );

    const res = await agent.post(`/api/admin/oauth-clients/${client.id}/rotate-secret`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('client_secret');
    expect(res.body.client_secret).toMatch(/^oacs_/);
    expect(res.body.client_secret).not.toBe(original);
    // Should NOT have any client data in the rotate response.
    expect(res.body).not.toHaveProperty('client_secret_hash');
  });

  it('writes an oauth_client_secret_rotated audit event', async () => {
    const agent = await asAdmin();
    const actor = await makeUser({ role: 'admin', primary_email: 'rotator2@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'RA', redirect_uris: [], allowed_scopes: [] }, actor.id);

    await agent.post(`/api/admin/oauth-clients/${client.id}/rotate-secret`);
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_secret_rotated' } });
    expect(events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/admin/oauth-clients/:id
// ---------------------------------------------------------------------------

describe('DELETE /api/admin/oauth-clients/:id', () => {
  it('returns 403 for non-admin', async () => {
    const agent = await asStudent();
    const res = await agent.delete('/api/admin/oauth-clients/1');
    expect(res.status).toBe(403);
  });

  it('soft-deletes (sets disabled_at) and returns 204', async () => {
    const agent = await asAdmin();
    const actor = await makeUser({ role: 'admin', primary_email: 'deleter@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'Del', redirect_uris: [], allowed_scopes: [] }, actor.id);

    const res = await agent.delete(`/api/admin/oauth-clients/${client.id}`);
    expect(res.status).toBe(204);

    const raw = await (prisma as any).oAuthClient.findUnique({ where: { id: client.id } });
    expect(raw).not.toBeNull();
    expect(raw.disabled_at).not.toBeNull();
  });

  it('writes an oauth_client_disabled audit event', async () => {
    const agent = await asAdmin();
    const actor = await makeUser({ role: 'admin', primary_email: 'deleter2@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'DA', redirect_uris: [], allowed_scopes: [] }, actor.id);

    await agent.delete(`/api/admin/oauth-clients/${client.id}`);
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_disabled' } });
    expect(events.length).toBeGreaterThan(0);
  });
});
