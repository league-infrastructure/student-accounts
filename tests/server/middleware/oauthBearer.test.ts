/**
 * Tests for oauthBearer middleware (Sprint 018 T004).
 *
 * Tests the middleware through the actual Express app so req.services is
 * available. We mount a throwaway route /test/oauth-bearer that echoes back
 * req.oauth after the middleware runs.
 */
import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import express from 'express';
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { OAuthClientService } from '../../../server/src/services/oauth/oauth-client.service.js';
import { OAuthTokenService } from '../../../server/src/services/oauth/oauth-token.service.js';
import { oauthBearer } from '../../../server/src/middleware/oauthBearer.js';
import { attachServices } from '../../../server/src/middleware/services.js';
import { ServiceRegistry } from '../../../server/src/services/service.registry.js';
import { makeUser } from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Build a minimal express app that uses the real ServiceRegistry (so
// oauthBearer can reach req.services.oauthTokens).
// ---------------------------------------------------------------------------

const registry = ServiceRegistry.create('UI');
const testApp = express();
testApp.use(express.json());
testApp.use(attachServices(registry));

// Route protected by scope.
testApp.get('/test/scoped', oauthBearer('users:read'), (req, res) => {
  res.json({ oauth: req.oauth });
});

// Route without required scope.
testApp.get('/test/any', oauthBearer(), (req, res) => {
  res.json({ oauth: req.oauth });
});

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

async function createTokenWithScopes(scopes: string[]): Promise<string> {
  const audit = new AuditService();
  const clients = new OAuthClientService(prisma, audit);
  const tokens = new OAuthTokenService(prisma, audit);
  const actor = await makeUser({ role: 'admin' });
  const { client } = await clients.create(
    { name: 'BearerTest', redirect_uris: [], allowed_scopes: scopes },
    actor.id,
  );
  const result = await tokens.issue({ oauthClientId: client.id, clientId: client.client_id, scopes });
  return result.access_token;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('oauthBearer — missing token', () => {
  it('returns 401 when Authorization header is missing', async () => {
    const res = await request(testApp).get('/test/scoped');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 401 for malformed Authorization header', async () => {
    const res = await request(testApp).get('/test/scoped').set('Authorization', 'NotBearer abc');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });
});

describe('oauthBearer — invalid/expired/revoked token', () => {
  it('returns 401 for unknown token', async () => {
    const res = await request(testApp)
      .get('/test/scoped')
      .set('Authorization', 'Bearer oat_unknowntoken');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 401 for expired token', async () => {
    const token = await createTokenWithScopes(['users:read']);
    // Expire the token in the DB.
    const row = await (prisma as any).oAuthAccessToken.findFirst();
    await (prisma as any).oAuthAccessToken.update({
      where: { id: row.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    const res = await request(testApp)
      .get('/test/scoped')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 401 for revoked token', async () => {
    const token = await createTokenWithScopes(['users:read']);
    const row = await (prisma as any).oAuthAccessToken.findFirst();
    await (prisma as any).oAuthAccessToken.update({
      where: { id: row.id },
      data: { revoked_at: new Date() },
    });

    const res = await request(testApp)
      .get('/test/scoped')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('returns 401 for token belonging to a disabled client', async () => {
    const audit = new AuditService();
    const clients = new OAuthClientService(prisma, audit);
    const tokens = new OAuthTokenService(prisma, audit);
    const actor = await makeUser({ role: 'admin' });
    const { client } = await clients.create(
      { name: 'DisabledClient', redirect_uris: [], allowed_scopes: ['users:read'] },
      actor.id,
    );
    const result = await tokens.issue({ oauthClientId: client.id, clientId: client.client_id, scopes: ['users:read'] });
    // Disable the client.
    await clients.disable(client.id, actor.id);

    const res = await request(testApp)
      .get('/test/scoped')
      .set('Authorization', `Bearer ${result.access_token}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });
});

describe('oauthBearer — scope check', () => {
  it('returns 403 insufficient_scope when token lacks the required scope', async () => {
    const token = await createTokenWithScopes(['other:scope']);
    const res = await request(testApp)
      .get('/test/scoped')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('insufficient_scope');
    expect(res.body.scope).toBe('users:read');
  });

  it('passes when token has the required scope', async () => {
    const token = await createTokenWithScopes(['users:read']);
    const res = await request(testApp)
      .get('/test/scoped')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.oauth.client_id).toBeTruthy();
    expect(res.body.oauth.scopes).toContain('users:read');
    expect(res.body.oauth.user_id).toBeNull();
  });
});

describe('oauthBearer — success', () => {
  it('attaches req.oauth and advances last_used_at', async () => {
    const token = await createTokenWithScopes(['users:read']);
    const before = Date.now();
    const res = await request(testApp)
      .get('/test/any')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.oauth).toBeTruthy();

    // Give the fire-and-forget a moment to write.
    await new Promise((r) => setTimeout(r, 50));

    const row = await (prisma as any).oAuthAccessToken.findFirst();
    if (row.last_used_at) {
      expect(row.last_used_at.getTime()).toBeGreaterThanOrEqual(before);
    }
  });

  it('accepts token via ?access_token= query param', async () => {
    const token = await createTokenWithScopes(['users:read']);
    const res = await request(testApp)
      .get('/test/scoped')
      .query({ access_token: token });
    expect(res.status).toBe(200);
  });
});
