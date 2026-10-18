/**
 * Integration tests for the fleet (laptop) machine endpoints (sprint 002 T007):
 *
 *   POST /api/fleet/llm-token
 *   POST /api/fleet/llm-token/rotate
 *
 * Public, credential-in-body, JSON only. Uses the real SQLite test database
 * via the shared Prisma client and the app's real service registry.
 */
import { describe, it, expect, beforeEach, afterAll, afterEach } from 'vitest';
import request from 'supertest';
import { createHash, randomBytes } from 'node:crypto';
import { prisma } from '../../../server/src/services/prisma.js';
import { hashPassword, makeCryptHash } from '../../../server/src/utils/password.js';
import { resetAttemptLimiter } from '../../../server/src/middleware/attemptLimiter.js';
import { makeUser } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GENERIC_401 = { error: 'Invalid username or password' };

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

/** A student with a scrypt password who already has the proxy flag on. */
async function makeStudent(
  username: string,
  password: string,
  overrides: Record<string, unknown> = {},
) {
  return makeUser({
    username,
    password_hash: await hashPassword(password),
    role: 'student',
    allows_llm_proxy: true,
    ...overrides,
  } as any);
}

function post(path: string, body: unknown, headers: Record<string, string> = {}) {
  return request(app).post(path).set(headers).send(body as any);
}

const fetchToken = (body: unknown, headers?: Record<string, string>) =>
  post('/api/fleet/llm-token', body, headers);
const rotateToken = (body: unknown, headers?: Record<string, string>) =>
  post('/api/fleet/llm-token/rotate', body, headers);

beforeEach(async () => {
  await cleanDb();
  resetAttemptLimiter();
  delete process.env.LLM_PROXY_ANTHROPIC_ENABLED;
});

afterEach(() => {
  delete process.env.LLM_PROXY_ANTHROPIC_ENABLED;
});

afterAll(async () => {
  await cleanDb();
});

// ===========================================================================
// 200 shape
// ===========================================================================

describe('POST /api/fleet/llm-token — success', () => {
  it('returns the token payload with base_url derived from the request host', async () => {
    const alice = await makeStudent('alice', 'purple-cactus-river');

    const res = await fetchToken(
      { username: 'alice', password: 'purple-cactus-river' },
      { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'student-accounts.jtlapp.net' },
    );

    expect(res.status).toBe(200);
    expect(res.headers['set-cookie']).toBeUndefined();
    expect(res.body).toEqual({
      user_id: alice.id,
      username: 'alice',
      api_key: expect.stringMatching(/^llmp_[A-Za-z0-9_-]+$/),
      base_url: 'https://student-accounts.jtlapp.net/proxy/v1',
      models: ['league-small', 'league-medium', 'league-large'],
      default_model: 'league-medium',
      token_limit: 1_000_000,
      tokens_used: 0,
      request_count: 0,
      expires_at: expect.any(String),
      granted_at: expect.any(String),
    });
    expect(res.body).not.toHaveProperty('anthropic_base_url');

    // Expires about a year out.
    const ttlDays = (new Date(res.body.expires_at).getTime() - Date.now()) / 86_400_000;
    expect(ttlDays).toBeGreaterThan(364);
    expect(ttlDays).toBeLessThan(366);

    // The returned key is the stored plaintext and validates on the proxy.
    const row = await registry.llmProxyTokens.getActiveForUser(alice.id);
    expect(row?.token_plaintext).toBe(res.body.api_key);
    await expect(registry.llmProxyTokens.validate(res.body.api_key)).resolves.toBeTruthy();
  });

  it('falls back to the Host header when no forwarding headers are present', async () => {
    await makeStudent('bob', 'pw-for-bob');
    const res = await fetchToken({ username: 'bob', password: 'pw-for-bob' });
    expect(res.status).toBe(200);
    expect(res.body.base_url).toMatch(/^http:\/\/127\.0\.0\.1:\d+\/proxy\/v1$/);
  });

  it('includes anthropic_base_url only when LLM_PROXY_ANTHROPIC_ENABLED is "true"', async () => {
    await makeStudent('carol', 'pw-for-carol');
    process.env.LLM_PROXY_ANTHROPIC_ENABLED = 'true';
    const res = await fetchToken(
      { username: 'carol', password: 'pw-for-carol' },
      { 'X-Forwarded-Proto': 'https', 'X-Forwarded-Host': 'accounts.example.org' },
    );
    expect(res.status).toBe(200);
    expect(res.body.anthropic_base_url).toBe('https://accounts.example.org/proxy');
    expect(res.body.base_url).toBe('https://accounts.example.org/proxy/v1');
  });

  it('returns the same api_key on a second call and creates only one token row', async () => {
    const alice = await makeStudent('alice', 'secret-one');
    const first = await fetchToken({ username: 'alice', password: 'secret-one' });
    const second = await fetchToken({ username: 'alice', password: 'secret-one' });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.api_key).toBe(first.body.api_key);
    expect(await (prisma as any).llmProxyToken.count({ where: { user_id: alice.id } })).toBe(1);
  });

  it('reuses a token an admin granted earlier instead of minting a new one', async () => {
    const admin = await makeUser({ role: 'admin' });
    const alice = await makeStudent('alice', 'secret-two', { allows_llm_proxy: false });
    const granted = await registry.llmProxyTokens.grant(
      alice.id,
      { expiresAt: new Date(Date.now() + 30 * 86_400_000), tokenLimit: 5000 },
      admin.id,
    );
    const res = await fetchToken({ username: 'alice', password: 'secret-two' });
    expect(res.status).toBe(200);
    expect(res.body.api_key).toBe(granted.token);
    expect(res.body.token_limit).toBe(5000);
  });

  it('accepts the identifier case-insensitively and by primary email, like login', async () => {
    const alice = await makeStudent('alice', 'secret-three', { primary_email: 'Alice@Example.com' });
    const byUpper = await fetchToken({ username: 'Alice', password: 'secret-three' });
    expect(byUpper.status).toBe(200);
    expect(byUpper.body.user_id).toBe(alice.id);
    const byEmail = await fetchToken({ username: 'Alice@Example.com', password: 'secret-three' });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.user_id).toBe(alice.id);
  });

  it('a staff user is served too', async () => {
    await makeStudent('ms-staff', 'staff-pw', { role: 'staff' });
    const res = await fetchToken({ username: 'ms-staff', password: 'staff-pw' });
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// Auto-grant and eligibility
// ===========================================================================

describe('POST /api/fleet/llm-token — auto-grant', () => {
  it('grants a laptop student (username + laptop hash) with the flag off and turns the flag on', async () => {
    const laptopHash = makeCryptHash('laptop-pw');
    const dana = await makeStudent('dana', 'laptop-pw', {
      allows_llm_proxy: false,
      laptop_password_hash: laptopHash,
    });
    expect((await (prisma as any).user.findUnique({ where: { id: dana.id } })).allows_llm_proxy).toBe(false);

    const res = await fetchToken({ username: 'dana', password: 'laptop-pw' });
    expect(res.status).toBe(200);
    expect(res.body.api_key).toMatch(/^llmp_/);

    const after = await (prisma as any).user.findUnique({ where: { id: dana.id } });
    expect(after.allows_llm_proxy).toBe(true);
    expect(await registry.llmProxyTokens.getActiveForUser(dana.id)).not.toBeNull();
  });

  it('403 { error: "llm proxy not enabled" } when the flag is off and there are no laptop credentials', async () => {
    const erin = await makeStudent('erin', 'erin-pw', { allows_llm_proxy: false });
    const res = await fetchToken({ username: 'erin', password: 'erin-pw' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'llm proxy not enabled' });
    expect(await registry.llmProxyTokens.getActiveForUser(erin.id)).toBeNull();
    // Correct credentials: not counted as a failure.
    const again = await fetchToken({ username: 'erin', password: 'erin-pw' });
    expect(again.status).toBe(403);
  });

  it('replaces an expired token with a new one', async () => {
    const frank = await makeStudent('frank', 'frank-pw');
    const oldPlain = 'llmp_expired_' + randomBytes(8).toString('base64url');
    await (prisma as any).llmProxyToken.create({
      data: {
        user_id: frank.id,
        token_hash: createHash('sha256').update(oldPlain).digest('hex'),
        token_plaintext: oldPlain,
        expires_at: new Date(Date.now() - 1000),
        token_limit: 1000,
        granted_by: null,
      },
    });

    const res = await fetchToken({ username: 'frank', password: 'frank-pw' });
    expect(res.status).toBe(200);
    expect(res.body.api_key).not.toBe(oldPlain);
    expect(res.body.api_key).toMatch(/^llmp_/);
    expect(await (prisma as any).llmProxyToken.count({ where: { user_id: frank.id } })).toBe(2);
  });
});

// ===========================================================================
// Rotate
// ===========================================================================

describe('POST /api/fleet/llm-token/rotate', () => {
  it('returns a new api_key; the old one is rejected by the proxy auth middleware', async () => {
    const alice = await makeStudent('alice', 'rotate-pw');
    const first = await fetchToken({ username: 'alice', password: 'rotate-pw' });
    expect(first.status).toBe(200);
    const oldKey: string = first.body.api_key;

    const rotated = await rotateToken({ username: 'alice', password: 'rotate-pw' });
    expect(rotated.status).toBe(200);
    expect(rotated.body.user_id).toBe(alice.id);
    expect(rotated.body.api_key).toMatch(/^llmp_/);
    expect(rotated.body.api_key).not.toBe(oldKey);

    // Old bearer → 401 from llmProxyTokenAuth (runs before the forwarder).
    const proxied = await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', `Bearer ${oldKey}`)
      .send({ model: 'league-small', messages: [{ role: 'user', content: 'hi' }] });
    expect(proxied.status).toBe(401);

    // New key validates; a plain fetch now returns the rotated key.
    await expect(registry.llmProxyTokens.validate(rotated.body.api_key)).resolves.toBeTruthy();
    const again = await fetchToken({ username: 'alice', password: 'rotate-pw' });
    expect(again.body.api_key).toBe(rotated.body.api_key);

    const rows = await (prisma as any).llmProxyToken.findMany({
      where: { user_id: alice.id },
      orderBy: { id: 'asc' },
    });
    expect(rows).toHaveLength(2);
    expect(rows[0].revoked_at).not.toBeNull();
    expect(rows[1].revoked_at).toBeNull();
  });

  it('grants when there is nothing to rotate yet', async () => {
    await makeStudent('gina', 'gina-pw');
    const res = await rotateToken({ username: 'gina', password: 'gina-pw' });
    expect(res.status).toBe(200);
    expect(res.body.api_key).toMatch(/^llmp_/);
  });

  it('applies the same credential and eligibility checks', async () => {
    await makeStudent('hank', 'hank-pw', { allows_llm_proxy: false });
    expect((await rotateToken({ username: 'hank', password: 'nope' })).status).toBe(401);
    expect((await rotateToken({ username: 'hank', password: 'hank-pw' })).status).toBe(403);
  });
});

// ===========================================================================
// Credential failures → generic 401
// ===========================================================================

describe('POST /api/fleet/llm-token — 401', () => {
  it('wrong password: same body as login, no token minted', async () => {
    const alice = await makeStudent('alice', 'right-pw');
    const res = await fetchToken({ username: 'alice', password: 'wrong-pw' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(GENERIC_401);

    const login = await post('/api/auth/login', { username: 'alice', password: 'wrong-pw' });
    expect(login.status).toBe(401);
    expect(res.body).toEqual(login.body);
    expect(await registry.llmProxyTokens.getActiveForUser(alice.id)).toBeNull();
  });

  it('unknown user, inactive user, admin role, missing fields, no password hash', async () => {
    await makeStudent('inactive', 'pw', { is_active: false });
    await makeStudent('boss', 'pw', { role: 'admin' });
    await makeUser({ username: 'oauth-only', password_hash: null, role: 'student', allows_llm_proxy: true });

    const cases: unknown[] = [
      { username: 'nobody', password: 'pw' },
      { username: 'inactive', password: 'pw' },
      { username: 'boss', password: 'pw' },
      { username: 'oauth-only', password: 'anything' },
      { username: 'x' },
      { password: 'pw' },
      {},
      { username: 42, password: 'pw' },
      { username: 'x', password: '' },
    ];
    for (const body of cases) {
      // Every case comes from supertest's one IP; keep the per-IP counter
      // out of the way so each case is judged on its credentials alone.
      resetAttemptLimiter();
      const res = await fetchToken(body);
      expect(res.status, JSON.stringify(body)).toBe(401);
      expect(res.body).toEqual(GENERIC_401);
    }
  });

  it('does not accept a group signup passphrase (no passphrase fallback)', async () => {
    const group = await (prisma as any).group.create({
      data: {
        name: 'Botball 26',
        signup_passphrase: 'orange-pencil-cloud',
        signup_passphrase_grant_llm_proxy: true,
        signup_passphrase_expires_at: new Date(Date.now() + 3_600_000),
        signup_passphrase_created_at: new Date(),
        signup_passphrase_created_by: null,
      },
    });
    const member = await makeStudent('member', 'their-real-pw');
    await (prisma as any).userGroup.create({ data: { user_id: member.id, group_id: group.id } });

    // Login accepts the passphrase for a member…
    const login = await post('/api/auth/login', { username: 'member', password: 'orange-pencil-cloud' });
    expect(login.status).toBe(200);
    // …the fleet endpoint does not.
    const res = await fetchToken({ username: 'member', password: 'orange-pencil-cloud' });
    expect(res.status).toBe(401);
    expect(res.body).toEqual(GENERIC_401);
  });
});

// ===========================================================================
// Attempt limiting → 429
// ===========================================================================

describe('POST /api/fleet/llm-token — 429', () => {
  it('6th failure for a username is 429, and a correct password is 429 while blocked', async () => {
    await makeStudent('alice', 'right-pw');
    for (let i = 0; i < 5; i++) {
      const res = await fetchToken({ username: 'alice', password: `wrong-${i}` });
      expect(res.status, `attempt ${i + 1}`).toBe(401);
    }
    const sixth = await fetchToken({ username: 'alice', password: 'wrong-6' });
    expect(sixth.status).toBe(429);
    expect(sixth.body).toEqual({ error: 'too many attempts' });

    const correct = await fetchToken({ username: 'alice', password: 'right-pw' });
    expect(correct.status).toBe(429);
    expect(correct.body).toEqual({ error: 'too many attempts' });

    const rotate = await rotateToken({ username: 'alice', password: 'right-pw' });
    expect(rotate.status).toBe(429);
  });

  it('blocks per client IP across different usernames', async () => {
    await makeStudent('victim', 'victim-pw');
    for (let i = 0; i < 5; i++) {
      const res = await fetchToken({ username: `scan-${i}`, password: 'x' });
      expect(res.status).toBe(401);
    }
    // Same IP (supertest), a different, correct user → still 429.
    const res = await fetchToken({ username: 'victim', password: 'victim-pw' });
    expect(res.status).toBe(429);
  });

  it('a correct password below the cap clears that username\'s failures', async () => {
    await makeStudent('alice', 'right-pw');
    for (let i = 0; i < 4; i++) {
      await fetchToken({ username: 'alice', password: 'wrong' });
    }
    expect((await fetchToken({ username: 'alice', password: 'right-pw' })).status).toBe(200);
    // Four more wrong attempts are allowed again (the IP counter is at 4,
    // so stop at one more to stay below the per-IP cap as well).
    expect((await fetchToken({ username: 'alice', password: 'wrong' })).status).toBe(401);
  });

  it('the reset hook unblocks (test isolation)', async () => {
    await makeStudent('alice', 'right-pw');
    for (let i = 0; i < 5; i++) await fetchToken({ username: 'alice', password: 'wrong' });
    expect((await fetchToken({ username: 'alice', password: 'right-pw' })).status).toBe(429);
    resetAttemptLimiter();
    expect((await fetchToken({ username: 'alice', password: 'right-pw' })).status).toBe(200);
  });
});

// ===========================================================================
// Imported laptop account ($6$ password_hash)
// ===========================================================================

describe('POST /api/fleet/llm-token — SHA-512 crypt password_hash', () => {
  /** Generated once with: openssl passwd -6 -salt Botball26Fixture secret */
  const OPENSSL_HASH =
    '$6$Botball26Fixture$aNQlHIWlqMgpWS186K6u6SNXkL1PWiMmeBpGdgZDL.21BIQ5wEIdE6hcD3xQ0DKPXanIltLYdvSyrgOikntZ./';

  it('authenticates an imported user and auto-grants (username + laptop hash)', async () => {
    const imported = await makeUser({
      username: 'laptop-alice',
      password_hash: OPENSSL_HASH,
      laptop_password_hash: OPENSSL_HASH,
      primary_email: 'laptop-alice@laptop.invalid',
      role: 'student',
      allows_llm_proxy: false,
      created_via: 'laptop_import' as any,
    });

    const res = await fetchToken({ username: 'laptop-alice', password: 'secret' });
    expect(res.status).toBe(200);
    expect(res.body.user_id).toBe(imported.id);
    expect(res.body.api_key).toMatch(/^llmp_/);

    const wrong = await fetchToken({ username: 'laptop-alice', password: 'Secret' });
    expect(wrong.status).toBe(401);

    // The fleet endpoint does not rehash; that is login's job.
    const after = await (prisma as any).user.findUnique({ where: { id: imported.id } });
    expect(after.password_hash).toBe(OPENSSL_HASH);
    expect(after.allows_llm_proxy).toBe(true);
  });

  it('works for a makeCryptHash hash too', async () => {
    const cryptHash = makeCryptHash('maple-robot-seven');
    await makeUser({
      username: 'laptop-bob',
      password_hash: cryptHash,
      laptop_password_hash: cryptHash,
      role: 'student',
      allows_llm_proxy: false,
    });
    const res = await fetchToken({ username: 'laptop-bob', password: 'maple-robot-seven' });
    expect(res.status).toBe(200);
  });
});

// ===========================================================================
// Audit
// ===========================================================================

describe('POST /api/fleet/llm-token — audit', () => {
  it('records fleet_llm_token_issued with the X-League-Host header', async () => {
    const alice = await makeStudent('alice', 'audit-pw');
    const res = await fetchToken(
      { username: 'alice', password: 'audit-pw' },
      { 'X-League-Host': 'league-laptop-07' },
    );
    expect(res.status).toBe(200);

    const rows = await (prisma as any).auditEvent.findMany({
      where: { action: 'fleet_llm_token_issued' },
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].actor_user_id).toBe(alice.id);
    expect(rows[0].target_user_id).toBe(alice.id);
    expect(rows[0].target_entity_type).toBe('LlmProxyToken');
    expect(rows[0].details).toEqual({ host: 'league-laptop-07' });
    expect(JSON.stringify(rows[0])).not.toContain('audit-pw');

    // Also the grant itself was audited with the fleet scope.
    const grants = await (prisma as any).auditEvent.findMany({ where: { action: 'grant_llm_proxy_token' } });
    expect(grants).toHaveLength(1);
    expect(grants[0].details.scope).toBe('fleet');
  });

  it('host is null when the header is absent; rotate records fleet_llm_token_rotated', async () => {
    await makeStudent('alice', 'audit-pw');
    await fetchToken({ username: 'alice', password: 'audit-pw' });
    const res = await rotateToken({ username: 'alice', password: 'audit-pw' });
    expect(res.status).toBe(200);

    const issued = await (prisma as any).auditEvent.findMany({ where: { action: 'fleet_llm_token_issued' } });
    expect(issued).toHaveLength(1);
    expect(issued[0].details).toEqual({ host: null });

    const rotated = await (prisma as any).auditEvent.findMany({ where: { action: 'fleet_llm_token_rotated' } });
    expect(rotated).toHaveLength(1);
    expect(rotated[0].details).toEqual({ host: null });

    const revokes = await (prisma as any).auditEvent.count({ where: { action: 'revoke_llm_proxy_token' } });
    expect(revokes).toBe(1);
  });

  it('a failed attempt writes no audit row', async () => {
    await makeStudent('alice', 'audit-pw');
    await fetchToken({ username: 'alice', password: 'wrong' });
    expect(await (prisma as any).auditEvent.count()).toBe(0);
  });
});
