/**
 * Integration tests for OAuth routes (Sprint 018 T003 + Sprint 019).
 * Covers:
 *   - POST /oauth/token: client_credentials, authorization_code, refresh_token
 *   - GET /oauth/userinfo
 *   - GET /oauth/authorize
 *   - POST /oauth/authorize/consent
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../../server/src/app.js';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser } from '../helpers/factories.js';
import { createHash } from 'node:crypto';

// RFC 7636 Appendix B test vectors
const RFC_VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk';
const RFC_CHALLENGE = 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM';

async function wipe() {
  await (prisma as any).oAuthAuthorizationCode.deleteMany();
  await (prisma as any).oAuthRefreshToken.deleteMany();
  await (prisma as any).oAuthConsent.deleteMany();
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
  it('returns 400 unsupported_grant_type for unknown grant', async () => {
    // 'magic_grant' is not a supported grant type (Sprint 019 adds
    // authorization_code and refresh_token; this tests a truly unknown value).
    const res = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'magic_grant', client_id: 'x', client_secret: 'y' });
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

// ===========================================================================
// Sprint 019 — GET /oauth/userinfo (ticket 008)
// ===========================================================================

async function createClientWithRedirect(scopes = ['profile']) {
  const actor = await makeUser({ role: 'admin' });
  const { client, plaintextSecret } = await registry.oauthClients.create(
    {
      name: 'Test Client 019',
      redirect_uris: ['https://example.com/cb'],
      allowed_scopes: scopes,
    },
    actor.id,
  );
  return { client, plaintextSecret, actor };
}

async function mintUserToken(userId: number, clientId: number, clientIdStr: string, scopes: string[]) {
  return registry.oauthTokens.issueForUser({
    oauthClientId: clientId,
    clientId: clientIdStr,
    userId,
    scopes,
  });
}

describe('GET /oauth/userinfo (ticket 008)', () => {
  it('happy path: returns { sub, email, name, role } for user-context token with profile scope', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const { access_token } = await mintUserToken(user.id, client.id, client.client_id, ['profile']);

    const res = await request(app)
      .get('/oauth/userinfo')
      .set('Authorization', `Bearer ${access_token}`);

    expect(res.status).toBe(200);
    expect(res.body.sub).toBe(String(user.id));
    expect(res.body.email).toBe(user.primary_email);
    expect(res.body.name).toBe(user.display_name);
    expect(res.body.role).toBe(user.role);
  });

  it('missing Authorization header → 401', async () => {
    const res = await request(app).get('/oauth/userinfo');
    expect(res.status).toBe(401);
  });

  it('expired token → 401', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const { access_token } = await mintUserToken(user.id, client.id, client.client_id, ['profile']);

    // Back-date expires_at.
    await (prisma as any).oAuthAccessToken.updateMany({ data: { expires_at: new Date(Date.now() - 1000) } });

    const res = await request(app)
      .get('/oauth/userinfo')
      .set('Authorization', `Bearer ${access_token}`);
    expect(res.status).toBe(401);
  });

  it('revoked token → 401', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const { access_token } = await mintUserToken(user.id, client.id, client.client_id, ['profile']);

    await (prisma as any).oAuthAccessToken.updateMany({ data: { revoked_at: new Date() } });

    const res = await request(app)
      .get('/oauth/userinfo')
      .set('Authorization', `Bearer ${access_token}`);
    expect(res.status).toBe(401);
  });

  it('token without profile scope → 403', async () => {
    const { client } = await createClientWithRedirect(['users:read']);
    const user = await makeUser({ role: 'student' });
    const { access_token } = await mintUserToken(user.id, client.id, client.client_id, ['users:read']);

    const res = await request(app)
      .get('/oauth/userinfo')
      .set('Authorization', `Bearer ${access_token}`);
    expect(res.status).toBe(403);
  });

  it('client-credentials token (user_id=null) → 404', async () => {
    const { client, plaintextSecret } = await createClientWithRedirect(['profile']);
    const tokenRes = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: client.client_id, client_secret: plaintextSecret });
    const { access_token } = tokenRes.body;

    const res = await request(app)
      .get('/oauth/userinfo')
      .set('Authorization', `Bearer ${access_token}`);
    expect(res.status).toBe(404);
  });

  it('user deleted between token mint and call → 404', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const { access_token } = await mintUserToken(user.id, client.id, client.client_id, ['profile']);

    // Null out user_id on the token row (simulates SetNull cascade), then delete user.
    // This keeps the token row valid so bearer auth passes, but user is gone.
    await (prisma as any).oAuthAccessToken.updateMany({
      where: { user_id: user.id },
      data: { user_id: null },
    });
    await (prisma as any).user.deleteMany({ where: { id: user.id } });

    const res = await request(app)
      .get('/oauth/userinfo')
      .set('Authorization', `Bearer ${access_token}`);
    // user_id is now null → treated like client-credentials → 404
    expect(res.status).toBe(404);
  });

  it('writes oauth_userinfo_call audit event', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const { access_token } = await mintUserToken(user.id, client.id, client.client_id, ['profile']);

    await request(app)
      .get('/oauth/userinfo')
      .set('Authorization', `Bearer ${access_token}`);

    // Wait briefly for fire-and-forget audit
    await new Promise((r) => setTimeout(r, 50));
    const event = await (prisma as any).auditEvent.findFirst({ where: { action: 'oauth_userinfo_call' } });
    expect(event).not.toBeNull();
  });
});

// ===========================================================================
// Sprint 019 — GET /oauth/authorize (ticket 005)
// ===========================================================================

async function loginAsUser(user: { id: number; primary_email: string; role: string }) {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email: user.primary_email, role: user.role });
  return agent;
}

describe('GET /oauth/authorize (ticket 005)', () => {
  it('unauthenticated → 302 to /login?next=<encoded-authorize-url>', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=https://example.com/cb&scope=profile&state=abc&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`;
    const res = await request(app).get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/login\?next=/);
    const nextEncoded = res.headers.location.split('next=')[1];
    const next = decodeURIComponent(nextEncoded);
    expect(next).toContain('/oauth/authorize');
  });

  it('authenticated + no consent → 302 to /oauth/consent?...', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const agent = await loginAsUser(user);

    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=https://example.com/cb&scope=profile&state=xyz&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`;
    const res = await agent.get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/oauth\/consent/);
  });

  it('authenticated + consent-on-file → 302 to redirect_uri?code=...&state=...', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    // Pre-record consent.
    await registry.oauthConsents.record({ user_id: user.id, client_id: client.id, scopes: ['profile'] });

    const agent = await loginAsUser(user);
    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=https://example.com/cb&scope=profile&state=mystate&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`;
    const res = await agent.get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(loc.origin + loc.pathname).toBe('https://example.com/cb');
    expect(loc.searchParams.get('code')).toBeTruthy();
    expect(loc.searchParams.get('state')).toBe('mystate');
  });

  it('missing code_challenge → 400 invalid_request', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=https://example.com/cb&scope=profile&state=abc&code_challenge_method=S256`;
    const res = await request(app).get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('code_challenge_method=plain → 400 invalid_request', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=https://example.com/cb&scope=profile&state=abc&code_challenge=${RFC_CHALLENGE}&code_challenge_method=plain`;
    const res = await request(app).get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('unknown client_id → 401 invalid_client', async () => {
    const params = `response_type=code&client_id=unknown_xyz&redirect_uri=https://example.com/cb&scope=profile&state=abc&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`;
    const res = await request(app).get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('disabled client → 401 invalid_client', async () => {
    const { client, actor } = await createClientWithRedirect(['profile']);
    await registry.oauthClients.disable(client.id, actor.id);
    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=https://example.com/cb&scope=profile&state=abc&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`;
    const res = await request(app).get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('disallowed redirect_uri → 400 invalid_request (not redirect)', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=https://evil.com/cb&scope=profile&state=abc&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`;
    const res = await request(app).get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('empty scope intersection → 400 invalid_scope', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=https://example.com/cb&scope=admin:all&state=abc&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`;
    const user = await makeUser({ role: 'student' });
    const agent = await loginAsUser(user);
    const res = await agent.get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_scope');
  });

  it('localhost-any-port: different port matches registered localhost entry', async () => {
    const actor = await makeUser({ role: 'admin' });
    const { client } = await registry.oauthClients.create(
      {
        name: 'Local Client',
        redirect_uris: ['http://localhost:8080/cb'],
        allowed_scopes: ['profile'],
      },
      actor.id,
    );
    const user = await makeUser({ role: 'student' });
    await registry.oauthConsents.record({ user_id: user.id, client_id: client.id, scopes: ['profile'] });
    const agent = await loginAsUser(user);

    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=http://localhost:5555/cb&scope=profile&state=xyz&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`;
    const res = await agent.get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/localhost:5555\/cb/);
  });

  it('consent-superset: consent for [profile, users:read] + request [profile] → mints code', async () => {
    const actor = await makeUser({ role: 'admin' });
    const { client } = await registry.oauthClients.create(
      { name: 'Multi', redirect_uris: ['https://example.com/cb'], allowed_scopes: ['profile', 'users:read'] },
      actor.id,
    );
    const user = await makeUser({ role: 'student' });
    await registry.oauthConsents.record({ user_id: user.id, client_id: client.id, scopes: ['profile', 'users:read'] });
    const agent = await loginAsUser(user);

    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=https://example.com/cb&scope=profile&state=x&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`;
    const res = await agent.get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(loc.searchParams.get('code')).toBeTruthy();
  });

  it('consent-subset: consent for [profile], request [profile, users:read] → prompt consent', async () => {
    const actor = await makeUser({ role: 'admin' });
    const { client } = await registry.oauthClients.create(
      { name: 'Multi2', redirect_uris: ['https://example.com/cb'], allowed_scopes: ['profile', 'users:read'] },
      actor.id,
    );
    const user = await makeUser({ role: 'student' });
    await registry.oauthConsents.record({ user_id: user.id, client_id: client.id, scopes: ['profile'] });
    const agent = await loginAsUser(user);

    const params = `response_type=code&client_id=${client.client_id}&redirect_uri=https://example.com/cb&scope=profile+users:read&state=x&code_challenge=${RFC_CHALLENGE}&code_challenge_method=S256`;
    const res = await agent.get(`/oauth/authorize?${params}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/\/oauth\/consent/);
  });
});

// ===========================================================================
// Sprint 019 — POST /oauth/authorize/consent (ticket 006)
// ===========================================================================

describe('POST /oauth/authorize/consent (ticket 006)', () => {
  it('allow: upserts consent, mints code, redirects to redirect_uri?code=...&state=...', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const agent = await loginAsUser(user);

    const res = await agent
      .post('/oauth/authorize/consent')
      .type('form')
      .send({
        client_id: client.client_id,
        redirect_uri: 'https://example.com/cb',
        scopes: 'profile',
        state: 'st1',
        code_challenge: RFC_CHALLENGE,
        code_challenge_method: 'S256',
        decision: 'allow',
      });

    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(loc.searchParams.get('code')).toBeTruthy();
    expect(loc.searchParams.get('state')).toBe('st1');

    // OAuthConsent row created.
    const consent = await (prisma as any).oAuthConsent.findFirst({ where: { user_id: user.id } });
    expect(consent).not.toBeNull();
  });

  it('deny: redirects to redirect_uri?error=access_denied&state=...', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const agent = await loginAsUser(user);

    const res = await agent
      .post('/oauth/authorize/consent')
      .type('form')
      .send({
        client_id: client.client_id,
        redirect_uri: 'https://example.com/cb',
        scopes: 'profile',
        state: 'st2',
        code_challenge: RFC_CHALLENGE,
        code_challenge_method: 'S256',
        decision: 'deny',
      });

    expect(res.status).toBe(302);
    const loc = new URL(res.headers.location);
    expect(loc.searchParams.get('error')).toBe('access_denied');
    expect(loc.searchParams.get('state')).toBe('st2');
    // No consent row.
    const consent = await (prisma as any).oAuthConsent.findFirst({ where: { user_id: user.id } });
    expect(consent).toBeNull();
  });

  it('re-consent upserts: only one row remains after two allow submissions', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const agent = await loginAsUser(user);

    for (let i = 0; i < 2; i++) {
      await agent
        .post('/oauth/authorize/consent')
        .type('form')
        .send({
          client_id: client.client_id,
          redirect_uri: 'https://example.com/cb',
          scopes: 'profile',
          state: 'st',
          code_challenge: RFC_CHALLENGE,
          code_challenge_method: 'S256',
          decision: 'allow',
        });
    }
    const consents = await (prisma as any).oAuthConsent.findMany({ where: { user_id: user.id } });
    expect(consents.length).toBe(1);
  });

  it('tampered redirect_uri → 400 invalid_request; does not redirect to tampered URI', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const agent = await loginAsUser(user);

    const res = await agent
      .post('/oauth/authorize/consent')
      .type('form')
      .send({
        client_id: client.client_id,
        redirect_uri: 'https://evil.com/cb',
        scopes: 'profile',
        state: 'st',
        code_challenge: RFC_CHALLENGE,
        code_challenge_method: 'S256',
        decision: 'allow',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
    // Must NOT have redirected to evil.com.
    expect(res.headers.location ?? '').not.toContain('evil.com');
  });

  it('tampered client_id (unknown) → 401 invalid_client', async () => {
    const user = await makeUser({ role: 'student' });
    const agent = await loginAsUser(user);

    const res = await agent
      .post('/oauth/authorize/consent')
      .type('form')
      .send({
        client_id: 'unknown_client',
        redirect_uri: 'https://example.com/cb',
        scopes: 'profile',
        state: 'st',
        code_challenge: RFC_CHALLENGE,
        code_challenge_method: 'S256',
        decision: 'allow',
      });

    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_client');
  });

  it('code_challenge_method=plain in form → 400 invalid_request', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });
    const agent = await loginAsUser(user);

    const res = await agent
      .post('/oauth/authorize/consent')
      .type('form')
      .send({
        client_id: client.client_id,
        redirect_uri: 'https://example.com/cb',
        scopes: 'profile',
        state: 'st',
        code_challenge: RFC_CHALLENGE,
        code_challenge_method: 'plain',
        decision: 'allow',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('unauthenticated POST → 401', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const res = await request(app)
      .post('/oauth/authorize/consent')
      .type('form')
      .send({
        client_id: client.client_id,
        redirect_uri: 'https://example.com/cb',
        scopes: 'profile',
        state: 'st',
        code_challenge: RFC_CHALLENGE,
        code_challenge_method: 'S256',
        decision: 'allow',
      });
    expect(res.status).toBe(401);
  });

  it('audit events written for allow and deny', async () => {
    const { client } = await createClientWithRedirect(['profile']);
    const user1 = await makeUser({ role: 'student' });
    const user2 = await makeUser({ role: 'student' });
    const agent1 = await loginAsUser(user1);
    const agent2 = await loginAsUser(user2);

    await agent1.post('/oauth/authorize/consent').type('form').send({
      client_id: client.client_id, redirect_uri: 'https://example.com/cb',
      scopes: 'profile', state: 'x', code_challenge: RFC_CHALLENGE, code_challenge_method: 'S256', decision: 'allow',
    });
    await agent2.post('/oauth/authorize/consent').type('form').send({
      client_id: client.client_id, redirect_uri: 'https://example.com/cb',
      scopes: 'profile', state: 'x', code_challenge: RFC_CHALLENGE, code_challenge_method: 'S256', decision: 'deny',
    });

    const granted = await (prisma as any).auditEvent.findFirst({ where: { action: 'oauth_consent_granted' } });
    const denied = await (prisma as any).auditEvent.findFirst({ where: { action: 'oauth_consent_denied' } });
    expect(granted).not.toBeNull();
    expect(denied).not.toBeNull();
  });
});

// ===========================================================================
// Sprint 019 — POST /oauth/token: authorization_code + refresh_token grants (ticket 007)
// ===========================================================================

describe('POST /oauth/token — authorization_code grant (ticket 007)', () => {
  it('full round trip: mint code → exchange → tokens', async () => {
    const { client, plaintextSecret } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        client_secret: plaintextSecret,
        code,
        redirect_uri: 'https://example.com/cb',
        code_verifier: RFC_VERIFIER,
      });

    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
    expect(res.body.refresh_token).toBeTruthy();
    expect(res.body.token_type).toBe('Bearer');
    expect(res.body.expires_in).toBeGreaterThan(0);
    expect(res.body.scope).toBe('profile');
  });

  it('PKCE verifier mismatch → 400 invalid_grant', async () => {
    const { client, plaintextSecret } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        client_secret: plaintextSecret,
        code,
        redirect_uri: 'https://example.com/cb',
        code_verifier: 'wrongverifier1234567890ABCDEFGHIJKLMNOPabcdefghijk',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('replayed code → 400 invalid_grant', async () => {
    const { client, plaintextSecret } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    const params = { grant_type: 'authorization_code', client_id: client.client_id, client_secret: plaintextSecret, code, redirect_uri: 'https://example.com/cb', code_verifier: RFC_VERIFIER };
    await request(app).post('/oauth/token').send(params);
    const res2 = await request(app).post('/oauth/token').send(params);
    expect(res2.status).toBe(400);
    expect(res2.body.error).toBe('invalid_grant');
  });

  it('mismatched redirect_uri between authorize and token → 400 invalid_grant', async () => {
    const { client, plaintextSecret } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        client_secret: plaintextSecret,
        code,
        redirect_uri: 'https://different.com/cb',
        code_verifier: RFC_VERIFIER,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_grant');
  });

  it('missing required fields → 400 invalid_request', async () => {
    const { client, plaintextSecret } = await createClientWithRedirect(['profile']);
    const res = await request(app)
      .post('/oauth/token')
      .send({
        grant_type: 'authorization_code',
        client_id: client.client_id,
        client_secret: plaintextSecret,
        // missing code, redirect_uri, code_verifier
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });

  it('client_credentials grant still works (no regression)', async () => {
    const { client, plaintextSecret } = await createClientWithRedirect(['profile']);
    const res = await request(app)
      .post('/oauth/token')
      .send({ grant_type: 'client_credentials', client_id: client.client_id, client_secret: plaintextSecret });
    expect(res.status).toBe(200);
    expect(res.body.access_token).toBeTruthy();
  });
});

describe('POST /oauth/token — refresh_token grant (ticket 007)', () => {
  it('full round trip: authorization_code → get refresh_token → rotate', async () => {
    const { client, plaintextSecret } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    const tokenRes = await request(app).post('/oauth/token').send({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      client_secret: plaintextSecret,
      code,
      redirect_uri: 'https://example.com/cb',
      code_verifier: RFC_VERIFIER,
    });
    const { refresh_token } = tokenRes.body;

    const rotateRes = await request(app).post('/oauth/token').send({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      client_secret: plaintextSecret,
      refresh_token,
    });

    expect(rotateRes.status).toBe(200);
    expect(rotateRes.body.access_token).toBeTruthy();
    expect(rotateRes.body.refresh_token).toBeTruthy();
    expect(rotateRes.body.refresh_token).not.toBe(refresh_token);
  });

  it('replayed refresh → 400 invalid_grant AND chain revoked in DB', async () => {
    const { client, plaintextSecret } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    const tokenRes = await request(app).post('/oauth/token').send({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      client_secret: plaintextSecret,
      code,
      redirect_uri: 'https://example.com/cb',
      code_verifier: RFC_VERIFIER,
    });
    const { refresh_token } = tokenRes.body;

    // First rotate.
    await request(app).post('/oauth/token').send({ grant_type: 'refresh_token', client_id: client.client_id, client_secret: plaintextSecret, refresh_token });

    // Replay original.
    const replayRes = await request(app).post('/oauth/token').send({ grant_type: 'refresh_token', client_id: client.client_id, client_secret: plaintextSecret, refresh_token });
    expect(replayRes.status).toBe(400);
    expect(replayRes.body.error).toBe('invalid_grant');

    // Chain should be revoked.
    const rows = await (prisma as any).oAuthRefreshToken.findMany();
    for (const row of rows) {
      expect(row.revoked_at).not.toBeNull();
    }
  });

  it('refresh from disabled client → 401 invalid_client', async () => {
    const { client, plaintextSecret, actor } = await createClientWithRedirect(['profile']);
    const user = await makeUser({ role: 'student' });

    const { code } = await registry.oauthCodes.mint({
      client_id: client.id,
      user_id: user.id,
      redirect_uri: 'https://example.com/cb',
      scopes: ['profile'],
      code_challenge: RFC_CHALLENGE,
      code_challenge_method: 'S256',
    });

    const tokenRes = await request(app).post('/oauth/token').send({
      grant_type: 'authorization_code',
      client_id: client.client_id,
      client_secret: plaintextSecret,
      code, redirect_uri: 'https://example.com/cb', code_verifier: RFC_VERIFIER,
    });
    const { refresh_token } = tokenRes.body;

    await registry.oauthClients.disable(client.id, actor.id);

    // Can no longer authenticate (disabled client fails verifySecret).
    const rotateRes = await request(app).post('/oauth/token').send({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      client_secret: plaintextSecret,
      refresh_token,
    });
    expect(rotateRes.status).toBe(401);
  });

  it('missing refresh_token field → 400 invalid_request', async () => {
    const { client, plaintextSecret } = await createClientWithRedirect(['profile']);
    const res = await request(app).post('/oauth/token').send({
      grant_type: 'refresh_token',
      client_id: client.client_id,
      client_secret: plaintextSecret,
    });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('invalid_request');
  });
});
