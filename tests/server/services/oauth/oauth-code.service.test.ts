/**
 * Integration tests for OAuthCodeService (Sprint 019 ticket 003).
 *
 * Tests against the real SQLite test DB — no mocks.
 * Includes RFC 7636 Appendix B test vectors for PKCE S256 verification.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { registry } from '../../../../server/src/app.js';
import { OAuthError } from '../../../../server/src/services/oauth/oauth-code.service.js';
import { makeUser } from '../../helpers/factories.js';

// RFC 7636 Appendix B test vectors
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function wipe() {
  await (prisma as any).oAuthAuthorizationCode.deleteMany();
  await (prisma as any).oAuthAccessToken.deleteMany();
  await (prisma as any).oAuthConsent.deleteMany();
  await (prisma as any).oAuthRefreshToken.deleteMany();
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

async function createClient(redirectUri = 'https://example.com/cb') {
  const actor = await makeUser({ role: 'admin' });
  const { client, plaintextSecret } = await registry.oauthClients.create(
    { name: 'Test Client', redirect_uris: [redirectUri], allowed_scopes: ['profile'] },
    actor.id,
  );
  return { client, plaintextSecret, actor };
}

async function createUser() {
  return makeUser({ role: 'student' });
}

// ---------------------------------------------------------------------------
// RFC 7636 PKCE test vector
// ---------------------------------------------------------------------------

describe('OAuthCodeService — PKCE RFC 7636 test vectors', () => {
  it('verifier → challenge matches Appendix B test vector', async () => {
    // Directly test the hash logic via mint+consume
    const { client } = await createClient();
    const user = await createUser();

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    // Should succeed with the matching verifier
    const result = await registry.oauthCodes.consume({
      code,
      redirect_uri: 'https://example.com/cb',
      code_verifier: RFC_VERIFIER,
    });

    expect(result.user_id).toBe(user.id);
    expect(result.oauth_client_id).toBe(client.id);
    expect(result.scopes).toEqual(['profile']);
  });
});

// ---------------------------------------------------------------------------
// Happy path
// ---------------------------------------------------------------------------

describe('OAuthCodeService — happy path', () => {
  it('mint then consume returns the code row with correct fields', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    expect(code).toBeTruthy();
    expect(typeof code).toBe('string');
    expect(code.length).toBeGreaterThan(10);

    const consumed = await registry.oauthCodes.consume({
      code,
      redirect_uri: 'https://example.com/cb',
      code_verifier: RFC_VERIFIER,
    });

    expect(consumed.user_id).toBe(user.id);
    expect(consumed.oauth_client_id).toBe(client.id);
    expect(consumed.scopes).toEqual(['profile']);
    expect(consumed.redirect_uri).toBe('https://example.com/cb');
  });
});

// ---------------------------------------------------------------------------
// Hash storage check
// ---------------------------------------------------------------------------

describe('OAuthCodeService — hash storage', () => {
  it('stores hash not plaintext in code_hash column', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    const rows = await (prisma as any).oAuthAuthorizationCode.findMany();
    expect(rows.length).toBe(1);
    expect(rows[0].code_hash).not.toBe(code); // hash != plaintext
    expect(rows[0].code_hash.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// Single-use enforcement
// ---------------------------------------------------------------------------

describe('OAuthCodeService — single-use', () => {
  it('replaying the same code throws invalid_grant', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    // First consume succeeds.
    await registry.oauthCodes.consume({
      code,
      redirect_uri: 'https://example.com/cb',
      code_verifier: RFC_VERIFIER,
    });

    // Second consume throws.
    await expect(
      registry.oauthCodes.consume({
        code,
        redirect_uri: 'https://example.com/cb',
        code_verifier: RFC_VERIFIER,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });

  it('concurrent consume: exactly one resolves, the other throws', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    const results = await Promise.allSettled([
      registry.oauthCodes.consume({ code, redirect_uri: 'https://example.com/cb', code_verifier: RFC_VERIFIER }),
      registry.oauthCodes.consume({ code, redirect_uri: 'https://example.com/cb', code_verifier: RFC_VERIFIER }),
    ]);

    const fulfilled = results.filter((r) => r.status === 'fulfilled');
    const rejected = results.filter((r) => r.status === 'rejected');
    expect(fulfilled.length).toBe(1);
    expect(rejected.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Expiry
// ---------------------------------------------------------------------------

describe('OAuthCodeService — expiry', () => {
  it('expired code throws invalid_grant', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    // Back-date expires_at.
    await (prisma as any).oAuthAuthorizationCode.updateMany({
      data: { expires_at: new Date(Date.now() - 1000) },
    });

    await expect(
      registry.oauthCodes.consume({
        code,
        redirect_uri: 'https://example.com/cb',
        code_verifier: RFC_VERIFIER,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

// ---------------------------------------------------------------------------
// PKCE verifier mismatch
// ---------------------------------------------------------------------------

describe('OAuthCodeService — PKCE verifier mismatch', () => {
  it('wrong code_verifier throws invalid_grant', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    await expect(
      registry.oauthCodes.consume({
        code,
        redirect_uri: 'https://example.com/cb',
        code_verifier: 'wrongverifier1234567890ABCDEFGHIJKLMNOPQRSTUVWXYZ',
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

// ---------------------------------------------------------------------------
// redirect_uri mismatch
// ---------------------------------------------------------------------------

describe('OAuthCodeService — redirect_uri mismatch', () => {
  it('different redirect_uri at consume throws invalid_grant', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    await expect(
      registry.oauthCodes.consume({
        code,
        redirect_uri: 'https://different.com/cb',
        code_verifier: RFC_VERIFIER,
      }),
    ).rejects.toMatchObject({ code: 'invalid_grant' });
  });
});

// ---------------------------------------------------------------------------
// Invalid code_challenge_method
// ---------------------------------------------------------------------------

describe('OAuthCodeService — code_challenge_method validation', () => {
  it('mint with code_challenge_method=plain throws invalid_request', async () => {
    const { client } = await createClient();
    const user = await createUser();

    await expect(
      registry.oauthCodes.mint({
        client_id: client.id,
        user_id: user.id,
        redirect_uri: 'https://example.com/cb',
        scopes: ['profile'],
        code_challenge: RFC_CHALLENGE,
        code_challenge_method: 'plain' as any,
      }),
    ).rejects.toMatchObject({ code: 'invalid_request' });
  });
});

// ---------------------------------------------------------------------------
// Audit events
// ---------------------------------------------------------------------------

describe('OAuthCodeService — audit events', () => {
  it('writes oauth_code_issued and oauth_code_consumed audit events', async () => {
    const { client } = await createClient();
    const user = await createUser();

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    await registry.oauthCodes.consume({
      code,
      redirect_uri: 'https://example.com/cb',
      code_verifier: RFC_VERIFIER,
    });

    const issued = await (prisma as any).auditEvent.findFirst({ where: { action: 'oauth_code_issued' } });
    const consumed = await (prisma as any).auditEvent.findFirst({ where: { action: 'oauth_code_consumed' } });
    expect(issued).not.toBeNull();
    expect(consumed).not.toBeNull();
  });
});
