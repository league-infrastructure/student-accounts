/**
 * Integration tests for OAuthRefreshService (Sprint 019 ticket 004).
 *
 * Tests against the real SQLite test DB — no mocks.
 * Security-sensitive: covers reuse-detect-and-revoke, disabled client, expiry.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { registry } from '../../../../server/src/app.js';
import { makeUser } from '../../helpers/factories.js';

async function wipe() {
  await (prisma as any).oAuthAuthorizationCode.deleteMany();
  await (prisma as any).oAuthRefreshToken.deleteMany();
  await (prisma as any).oAuthAccessToken.deleteMany();
  await (prisma as any).oAuthConsent.deleteMany();
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

async function createClient(scopes = ['profile']) {
  const actor = await makeUser({ role: 'admin' });
  const { client, plaintextSecret } = await registry.oauthClients.create(
    { name: 'Test Client', redirect_uris: ['https://example.com/cb'], allowed_scopes: scopes },
    actor.id,
  );
  return { client, plaintextSecret, actor };
}

async function createUser() {
  return makeUser({ role: 'student' });
}

// ---------------------------------------------------------------------------
// Happy path: mint + rotate
// ---------------------------------------------------------------------------

describe('OAuthRefreshService — mint', () => {
  it('mint returns a plaintext token string', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { token } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });

    expect(token).toBeTruthy();
    expect(typeof token).toBe('string');
    expect(token.length).toBeGreaterThan(10);
  });

  it('mint stores hash not plaintext', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { token } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });

    const rows = await (prisma as any).oAuthRefreshToken.findMany();
    expect(rows.length).toBe(1);
    expect(rows[0].token_hash).not.toBe(token);
  });
});

describe('OAuthRefreshService — rotate', () => {
  it('rotate returns new refresh token, access token, scopes', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { token } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });

    const result = await registry.oauthRefreshTokens.rotate({ token });

    expect(result.refresh_token).toBeTruthy();
    expect(result.access_token).toBeTruthy();
    expect(result.expires_in).toBeGreaterThan(0);
    expect(result.scopes).toEqual(['profile']);
    // New refresh token is different from old
    expect(result.refresh_token).not.toBe(token);
  });

  it('rotate: old row has replaced_by_id pointing to new row', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { token } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });

    await registry.oauthRefreshTokens.rotate({ token });

    const rows = await (prisma as any).oAuthRefreshToken.findMany({ orderBy: { id: 'asc' } });
    expect(rows.length).toBe(2);
    expect(rows[0].replaced_by_id).toBe(rows[1].id); // old → new
    expect(rows[1].replaced_by_id).toBeNull(); // new has no successor yet
  });

  it('chain of 3 rotations: each old row points to successor', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { token: t1 } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });

    const { refresh_token: t2 } = await registry.oauthRefreshTokens.rotate({ token: t1 });
    const { refresh_token: t3 } = await registry.oauthRefreshTokens.rotate({ token: t2 });

    // Verify t3 is usable (not revoked)
    const result = await registry.oauthRefreshTokens.rotate({ token: t3 });
    expect(result.refresh_token).toBeTruthy();

    const rows = await (prisma as any).oAuthRefreshToken.findMany({ orderBy: { id: 'asc' } });
    expect(rows.length).toBe(4);
    // Each row points to the next
    expect(rows[0].replaced_by_id).toBe(rows[1].id);
    expect(rows[1].replaced_by_id).toBe(rows[2].id);
    expect(rows[2].replaced_by_id).toBe(rows[3].id);
    expect(rows[3].replaced_by_id).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Reuse detection
// ---------------------------------------------------------------------------

describe('OAuthRefreshService — reuse detection (security)', () => {
  it('[SECURITY] replaying already-rotated token revokes entire chain and throws invalid_grant', async () => {
    const { client } = await createClient();
    const user = await createUser();

    // Create chain: original → rotated → rotated2
    const { token: original } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });
    const { refresh_token: rotated } = await registry.oauthRefreshTokens.rotate({ token: original });
    await registry.oauthRefreshTokens.rotate({ token: rotated });

    // Now replay the original (already replaced) token.
    await expect(
      registry.oauthRefreshTokens.rotate({ token: original }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });

    // ALL rows in the chain must be revoked.
    const rows = await (prisma as any).oAuthRefreshToken.findMany();
    expect(rows.length).toBe(3);
    for (const row of rows) {
      expect(row.revoked_at).not.toBeNull();
    }
  });

  it('[SECURITY] security audit event is written on reuse detection', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { token } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });
    await registry.oauthRefreshTokens.rotate({ token });

    // Replay original
    await expect(registry.oauthRefreshTokens.rotate({ token })).rejects.toMatchObject({ code: 'invalid_grant' });

    const event = await (prisma as any).auditEvent.findFirst({
      where: { action: 'oauth_refresh_reuse_detected' },
    });
    expect(event).not.toBeNull();
    const details = typeof event.details === 'string'
      ? JSON.parse(event.details)
      : event.details;
    expect(details).toMatchObject({ severity: 'security' });
  });
});

// ---------------------------------------------------------------------------
// Disabled client
// ---------------------------------------------------------------------------

describe('OAuthRefreshService — disabled client', () => {
  it('rotate from disabled client throws invalid_client', async () => {
    const { client, actor } = await createClient();
    const user = await createUser();

    const { token } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });

    // Disable the client.
    await registry.oauthClients.disable(client.id, actor.id);

    await expect(
      registry.oauthRefreshTokens.rotate({ token }),
    ).rejects.toMatchObject({ code: 'invalid_client' });
  });
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

describe('OAuthRefreshService — expiry', () => {
  it('expired refresh token throws invalid_grant', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { token } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });

    // Back-date expires_at.
    await (prisma as any).oAuthRefreshToken.updateMany({
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    await expect(
      registry.oauthRefreshTokens.rotate({ token }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

// ---------------------------------------------------------------------------
// Revoked token
// ---------------------------------------------------------------------------

describe('OAuthRefreshService — revoked token', () => {
  it('revoked refresh token throws invalid_grant', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { token } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });

    // Revoke the token directly.
    await (prisma as any).oAuthRefreshToken.updateMany({
      data: { revoked_at: new Date() },
    });

    await expect(
      registry.oauthRefreshTokens.rotate({ token }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

describe('OAuthRefreshService — audit events', () => {
  it('writes oauth_refresh_minted and oauth_refresh_rotated', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { token } = await registry.oauthRefreshTokens.mint({
      client_id: client.id,
      user_id: user.id,
      scopes: ['profile'],
    });
    await registry.oauthRefreshTokens.rotate({ token });

    const minted = await (prisma as any).auditEvent.findFirst({ where: { action: 'oauth_refresh_minted' } });
    const rotated = await (prisma as any).auditEvent.findFirst({ where: { action: 'oauth_refresh_rotated' } });
    expect(minted).not.toBeNull();
    expect(rotated).not.toBeNull();
  });
});
