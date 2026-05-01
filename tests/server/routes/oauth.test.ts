/**
 * Integration tests for POST /oauth/token (Sprint 018 T003).
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

async function createClient(scopes = ['users:read']) {
  const actor = await makeUser({ role: 'admin' });
  const { client, plaintextSecret } = await registry.oauthClients.create(
    { name: 'Test Client', redirect_uris: [], allowed_scopes: scopes },
    actor.id,
  );
  return { client, plaintextSecret };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('POST /oauth/token — grant_type validation', () => {
  it('returns 400 unsupported_grant_type for wrong grant', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'authorization_code', client_id: 'x', client_secret: 'y' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });

  it('returns 400 unsupported_grant_type when grant_type is missing', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .send({ client_id: 'x', client_secret: 'y' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('unsupported_grant_type');
  });
});

describe('POST /oauth/token — credentials validation', () => {
  it('returns 401 invalid_client for unknown client_id', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: 'unknown', client_secret: 'wrong' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('returns 401 invalid_client for wrong secret', async () => {
    const { client } = await createClient();
    const res = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: client.client_id, client_secret: 'wrongsecret' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('returns 401 invalid_client for disabled client', async () => {
    const actor = await makeUser({ role: 'admin' });
    const { client, plaintextSecret } = await registry.oauthClients.create(
      { name: 'Disabled', redirect_uris: [], allowed_scopes: ['users:read'] },
      actor.id,
    );
    await registry.oauthClients.disable(client.id, actor.id);

    const res = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: client.client_id, client_secret: plaintextSecret });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('returns 401 invalid_client when no credentials provided', async () => {
    const res = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'client_credentials' });
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });
});

describe('POST /oauth/token — happy path (form fields)', () => {
  it('returns valid OAuth response with form-field credentials', async () => {
    const { client, plaintextSecret } = await createClient(['users:read']);

    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: client.client_id,
        client_secret: plaintextSecret,
      });

    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBe(3600);
    expect(res.body.access_token).toMatch(/^oat_/);
    expect(res.body.scope).toBe('users:read');
  });

  it('defaults scope to all allowed_scopes when scope not specified', async () => {
    const { client, plaintextSecret } = await createClient(['users:read', 'users:write']);

    const res = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: client.client_id, client_secret: plaintextSecret });

    expect(res.status).toBe(200);
    // Scope should contain both allowed scopes
    const returnedScopes = res.body.scope.split(' ');
    expect(returnedScopes).toContain('users:read');
    expect(returnedScopes).toContain('users:write');
  });
});

describe('POST /oauth/token — happy path (Basic auth header)', () => {
  it('accepts Basic auth credentials', async () => {
    const { client, plaintextSecret } = await createClient(['users:read']);
    const b64 = Buffer.from(`${client.client_id}:${plaintextSecret}`).toString('base64');

    const res = await request(app)
      .post('/oauth/token')
      .set('Authorization', `Basic ${b64}`)
      .send({ grant_type: 'client_credentials' });

    expect(res.status).toBe(200);
    expect(res.body.token_type).toBe('Bearer');
  });
});

describe('POST /oauth/token — scope negotiation', () => {
  it('narrows to requested subset of allowed scopes', async () => {
    const { client, plaintextSecret } = await createClient(['users:read', 'users:write']);

    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: client.client_id,
        client_secret: plaintextSecret,
        scope: 'users:read',
      });

    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('users:read');
  });

  it('returns 400 invalid_scope when requested scopes disjoint from allowed', async () => {
    const { client, plaintextSecret } = await createClient(['users:read']);

    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'client_credentials',
        client_id: client.client_id,
        client_secret: plaintextSecret,
        scope: 'admin:all',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
  });
});

describe('POST /oauth/token — audit event', () => {
  it('writes oauth_token_issued audit event on success', async () => {
    const { client, plaintextSecret } = await createClient(['users:read']);
    await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: client.client_id, client_secret: plaintextSecret });

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_token_issued' } });
    expect(events.length).toBeGreaterThan(0);
  });
});
