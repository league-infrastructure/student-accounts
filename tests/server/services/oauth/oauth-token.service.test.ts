/**
 * Integration tests for OAuthTokenService (Sprint 018 T003).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { OAuthClientService } from '../../../../server/src/services/oauth/oauth-client.service.js';
import { OAuthTokenService } from '../../../../server/src/services/oauth/oauth-token.service.js';
import { makeUser } from '../../helpers/factories.js';

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

function makeServices() {
  const audit = new AuditService();
  return {
    clients: new OAuthClientService(prisma, audit),
    tokens: new OAuthTokenService(prisma, audit),
  };
}

describe('OAuthTokenService.issue', () => {
  it('returns the oauth response shape and stores only the hash', async () => {
    const actor = await makeUser({ role: 'admin' });
    const { clients, tokens } = makeServices();
    const { client } = await clients.create(
      { name: 'T1', redirect_uris: [], allowed_scopes: ['users:read'] },
      actor.id,
    );

    const result = await tokens.issue({
      oauthClientId: client.id,
      clientId: client.client_id,
      scopes: ['users:read'],
    });

    expect(result.token_type).toBe('Bearer');
    expect(result.expires_in).toBe(3600);
    expect(result.access_token).toMatch(/^oat_/);
    expect(result.scope).toBe('users:read');

    // The plaintext should NOT be in the DB.
    const rows = await (prisma as any).oAuthAccessToken.findMany();
    expect(rows).toHaveLength(1);
    expect(rows[0].token_hash).not.toBe(result.access_token);
  });

  it('sets expires_at ~1 hour in the future', async () => {
    const actor = await makeUser({ role: 'admin' });
    const { clients, tokens } = makeServices();
    const { client } = await clients.create({ name: 'T2', redirect_uris: [], allowed_scopes: [] }, actor.id);

    const before = Date.now();
    await tokens.issue({ oauthClientId: client.id, clientId: client.client_id, scopes: [] });
    const after = Date.now();

    const row = await (prisma as any).oAuthAccessToken.findFirst();
    const expiry = row.expires_at.getTime();
    expect(expiry).toBeGreaterThan(before + 3590 * 1000);
    expect(expiry).toBeLessThan(after + 3610 * 1000);
  });

  it('writes an oauth_token_issued audit event', async () => {
    const actor = await makeUser({ role: 'admin' });
    const { clients, tokens } = makeServices();
    const { client } = await clients.create({ name: 'T3', redirect_uris: [], allowed_scopes: ['users:read'] }, actor.id);

    await tokens.issue({ oauthClientId: client.id, clientId: client.client_id, scopes: ['users:read'] });

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_token_issued' } });
    expect(events).toHaveLength(1);
  });
});

describe('OAuthTokenService.validate', () => {
  it('returns validation info for a valid token', async () => {
    const actor = await makeUser({ role: 'admin' });
    const { clients, tokens } = makeServices();
    const { client } = await clients.create(
      { name: 'V1', redirect_uris: [], allowed_scopes: ['users:read'] },
      actor.id,
    );
    const { access_token } = await tokens.issue({
      oauthClientId: client.id,
      clientId: client.client_id,
      scopes: ['users:read'],
    });

    const info = await tokens.validate(access_token);
    expect(info).not.toBeNull();
    expect(info!.client_id).toBe(client.client_id);
    expect(info!.scopes).toEqual(['users:read']);
    expect(info!.user_id).toBeNull();
  });

  it('returns null for an unknown token', async () => {
    const { tokens } = makeServices();
    expect(await tokens.validate('oat_notarealtoken')).toBeNull();
  });

  it('returns null for an expired token', async () => {
    const actor = await makeUser({ role: 'admin' });
    const { clients, tokens } = makeServices();
    const { client } = await clients.create({ name: 'V2', redirect_uris: [], allowed_scopes: [] }, actor.id);

    const { access_token } = await tokens.issue({
      oauthClientId: client.id,
      clientId: client.client_id,
      scopes: [],
    });

    // Manually expire the token.
    const row = await (prisma as any).oAuthAccessToken.findFirst();
    await (prisma as any).oAuthAccessToken.update({
      where: { id: row.id },
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    expect(await tokens.validate(access_token)).toBeNull();
  });
});
