/**
 * Integration tests for GET /v1/users and GET /v1/users/:id (Sprint 018 T005).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../../server/src/app.js';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser } from '../helpers/factories.js';

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

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createClientAndToken(scopes = ['users:read']) {
  const actor = await makeUser({ role: 'admin' });
  const { client, plaintextSecret } = await registry.oauthClients.create(
    { name: 'Directory Test Client', redirect_uris: [], allowed_scopes: scopes },
    actor.id,
  );
  const tokenResult = await registry.oauthTokens.issue({
    oauthClientId: client.id,
    clientId: client.client_id,
    scopes,
  });
  return { token: tokenResult.access_token, client, actor };
}

// ---------------------------------------------------------------------------
// GET /v1/users — auth
// ---------------------------------------------------------------------------

describe('GET /v1/users — auth', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/v1/users');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 403 with token missing users:read scope', async () => {
    const { token } = await createClientAndToken(['other:scope']);
    const res = await request(app).get('/v1/users').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
  });
});

// ---------------------------------------------------------------------------
// GET /v1/users — happy path
// ---------------------------------------------------------------------------

describe('GET /v1/users — happy path', () => {
  it('returns paginated user list with correct fields', async () => {
    const { token } = await createClientAndToken();
    await makeUser({ display_name: 'Alice', primary_email: 'alice@test.com' });
    await makeUser({ display_name: 'Bob', primary_email: 'bob@test.com' });

    const res = await request(app)
      .get('/v1/users')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('users');
    expect(res.body).toHaveProperty('page', 1);
    expect(res.body).toHaveProperty('per_page', 50);
    expect(res.body).toHaveProperty('total');
    expect(Array.isArray(res.body.users)).toBe(true);

    // Check field allowlist — no sensitive data.
    const user = res.body.users[0];
    expect(user).toHaveProperty('id');
    expect(user).toHaveProperty('display_name');
    expect(user).toHaveProperty('primary_email');
    expect(user).toHaveProperty('role');
    expect(user).toHaveProperty('is_active');
    expect(user).not.toHaveProperty('password_hash');
    expect(user).not.toHaveProperty('username');
    expect(user).not.toHaveProperty('cohort_id');  // Not in list response
    expect(user).not.toHaveProperty('created_at'); // Not in list response
  });

  it('respects pagination — page and per_page', async () => {
    const { token } = await createClientAndToken();
    // Create 3 users in addition to the admin user already created.
    await makeUser(); await makeUser(); await makeUser();

    const res = await request(app)
      .get('/v1/users?page=1&per_page=2')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.users.length).toBe(2);
    expect(res.body.per_page).toBe(2);
    expect(res.body.page).toBe(1);
  });

  it('caps per_page at 200', async () => {
    const { token } = await createClientAndToken();
    const res = await request(app)
      .get('/v1/users?per_page=999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.per_page).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/users — audit
// ---------------------------------------------------------------------------

describe('GET /v1/users — audit', () => {
  it('writes an oauth_directory_call audit event', async () => {
    const { token } = await createClientAndToken();
    await request(app).get('/v1/users').set('Authorization', `Bearer ${token}`);

    // Give the async audit write a moment.
    await new Promise((r) => setTimeout(r, 50));

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_directory_call' } });
    expect(events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/users/:id — happy path
// ---------------------------------------------------------------------------

describe('GET /v1/users/:id — happy path', () => {
  it('returns user with extended fields', async () => {
    const { token } = await createClientAndToken();
    const user = await makeUser({ display_name: 'Tester', primary_email: 'tester@test.com' });

    const res = await request(app)
      .get(`/v1/users/${user.id}`)
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.id).toBe(user.id);
    expect(res.body.display_name).toBe('Tester');
    expect(res.body).toHaveProperty('cohort_id');
    expect(res.body).toHaveProperty('created_at');
    expect(res.body).not.toHaveProperty('password_hash');
  });

  it('returns 404 for unknown user', async () => {
    const { token } = await createClientAndToken();
    const res = await request(app)
      .get('/v1/users/9999999')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET /v1/users/:id — auth
// ---------------------------------------------------------------------------

describe('GET /v1/users/:id — auth', () => {
  it('returns 401 without token', async () => {
    const res = await request(app).get('/v1/users/1');
    expect(res.status).toBe(401);
  });

  it('returns 403 with wrong-scope token', async () => {
    const { token } = await createClientAndToken(['other:scope']);
    const res = await request(app).get('/v1/users/1').set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
  });
});
