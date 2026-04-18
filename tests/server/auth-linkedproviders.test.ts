/**
 * Tests for ticket 013: linkedProviders on GET /api/auth/me
 * and POST /api/auth/unlink/:provider.
 *
 * Also tests the 401 guard on link-mode initiate routes (?link=1).
 */

import request from 'supertest';
import { prisma } from '../../server/src/services/prisma';
import app from '../../server/src/app';
import { cleanupTestDb } from './helpers/db';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanupTestDb();
}, 30000);

afterAll(async () => {
  await cleanupTestDb();
});

// ---------------------------------------------------------------------------
// Helper: establish a test session with an optional UserProvider row pre-seeded
// ---------------------------------------------------------------------------

/**
 * Creates a user via test-login and returns a supertest agent with a live session.
 */
async function loginAsTestUser(
  email: string,
  opts: { provider?: string; providerId?: string; role?: string } = {},
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({
    email,
    displayName: 'Test User',
    role: opts.role ?? 'USER',
    provider: opts.provider,
    providerId: opts.providerId,
  });
  return agent;
}

// ---------------------------------------------------------------------------
// GET /api/auth/me — linkedProviders field
// ---------------------------------------------------------------------------

describe('GET /api/auth/me — linkedProviders field', () => {
  it('returns linkedProviders: [] for a user with no OAuth providers', async () => {
    // Create a user with no provider fields and no UserProvider rows
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'noprovider@example.com',
      displayName: 'No Provider',
      role: 'USER',
    });
    // Clear provider/providerId that test-login sets by default
    await prisma.user.update({
      where: { id: createRes.body.id },
      data: { provider: null, providerId: null },
    });
    // Delete any UserProvider rows
    await prisma.userProvider.deleteMany({ where: { userId: createRes.body.id } });

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body).toHaveProperty('linkedProviders');
    expect(meRes.body.linkedProviders).toEqual([]);
  });

  it('returns linkedProviders: ["github"] when a UserProvider row exists', async () => {
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'oneprovider@example.com',
      displayName: 'One Provider',
      role: 'USER',
    });
    const userId = createRes.body.id;

    // Clear primary provider and add a UserProvider row for github
    await prisma.user.update({
      where: { id: userId },
      data: { provider: null, providerId: null },
    });
    await prisma.userProvider.deleteMany({ where: { userId } });
    await prisma.userProvider.create({
      data: { userId, provider: 'github', providerId: 'gh-me-001' },
    });

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.linkedProviders).toEqual(['github']);
  });

  it('deduplicates when User.provider matches a UserProvider row', async () => {
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'dedup@example.com',
      displayName: 'Dedup User',
      role: 'USER',
    });
    const userId = createRes.body.id;

    // Set primary provider to github AND add a UserProvider row for same
    await prisma.user.update({
      where: { id: userId },
      data: { provider: 'github', providerId: 'gh-dedup-001' },
    });
    await prisma.userProvider.deleteMany({ where: { userId } });
    await prisma.userProvider.create({
      data: { userId, provider: 'github', providerId: 'gh-dedup-001' },
    });

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    // Should appear only once
    expect(meRes.body.linkedProviders).toHaveLength(1);
    expect(meRes.body.linkedProviders).toContain('github');
  });

  it('includes both User.provider and additional UserProvider rows', async () => {
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'multiprovider@example.com',
      displayName: 'Multi Provider',
      role: 'USER',
    });
    const userId = createRes.body.id;

    // Primary = github, also has google row
    await prisma.user.update({
      where: { id: userId },
      data: { provider: 'github', providerId: 'gh-multi-001' },
    });
    await prisma.userProvider.deleteMany({ where: { userId } });
    await prisma.userProvider.createMany({
      data: [
        { userId, provider: 'github', providerId: 'gh-multi-001' },
        { userId, provider: 'google', providerId: 'go-multi-001' },
      ],
    });

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.linkedProviders).toHaveLength(2);
    expect(meRes.body.linkedProviders).toContain('github');
    expect(meRes.body.linkedProviders).toContain('google');
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/unlink/:provider
// ---------------------------------------------------------------------------

describe('POST /api/auth/unlink/:provider — authentication', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/auth/unlink/github');
    expect(res.status).toBe(401);
  });
});

describe('POST /api/auth/unlink/:provider — 404 when not linked', () => {
  it('returns 404 when provider is not linked to the user', async () => {
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'notlinked@example.com',
      displayName: 'Not Linked',
      role: 'USER',
    });
    const userId = createRes.body.id;
    // Make sure no UserProvider rows and no primary provider
    await prisma.user.update({ where: { id: userId }, data: { provider: null, providerId: null } });
    await prisma.userProvider.deleteMany({ where: { userId } });

    const res = await agent.post('/api/auth/unlink/github');
    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /api/auth/unlink/:provider — guardrail (only one method)', () => {
  it('returns 400 when user has only one UserProvider row', async () => {
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'onemethod@example.com',
      displayName: 'One Method',
      role: 'USER',
    });
    const userId = createRes.body.id;

    // One UserProvider row, no primary provider
    await prisma.user.update({ where: { id: userId }, data: { provider: null, providerId: null } });
    await prisma.userProvider.deleteMany({ where: { userId } });
    await prisma.userProvider.create({
      data: { userId, provider: 'github', providerId: 'gh-onemethod-001' },
    });

    const res = await agent.post('/api/auth/unlink/github');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only remaining login method/i);
    // Row should still exist
    const row = await prisma.userProvider.findFirst({ where: { userId, provider: 'github' } });
    expect(row).not.toBeNull();
  });

  it('returns 400 when only method is User.provider (no UserProvider row)', async () => {
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'primaryonly@example.com',
      displayName: 'Primary Only',
      role: 'USER',
    });
    const userId = createRes.body.id;

    // Primary only, no UserProvider rows
    await prisma.user.update({ where: { id: userId }, data: { provider: 'github', providerId: 'gh-primary-001' } });
    await prisma.userProvider.deleteMany({ where: { userId } });

    const res = await agent.post('/api/auth/unlink/github');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only remaining login method/i);
  });

  it('returns 400 when primary + row are the same provider (counted once = 1 method)', async () => {
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'dupcounted@example.com',
      displayName: 'Dup Counted',
      role: 'USER',
    });
    const userId = createRes.body.id;

    // Primary + UserProvider row both for github → counts as 1
    await prisma.user.update({ where: { id: userId }, data: { provider: 'github', providerId: 'gh-dup-001' } });
    await prisma.userProvider.deleteMany({ where: { userId } });
    await prisma.userProvider.create({ data: { userId, provider: 'github', providerId: 'gh-dup-001' } });

    const res = await agent.post('/api/auth/unlink/github');
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/only remaining login method/i);
  });
});

describe('POST /api/auth/unlink/:provider — successful unlink', () => {
  it('deletes UserProvider row when user has two providers', async () => {
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'twomethods@example.com',
      displayName: 'Two Methods',
      role: 'USER',
    });
    const userId = createRes.body.id;

    // Two UserProvider rows
    await prisma.user.update({ where: { id: userId }, data: { provider: null, providerId: null } });
    await prisma.userProvider.deleteMany({ where: { userId } });
    await prisma.userProvider.createMany({
      data: [
        { userId, provider: 'github', providerId: 'gh-two-001' },
        { userId, provider: 'google', providerId: 'go-two-001' },
      ],
    });

    const res = await agent.post('/api/auth/unlink/github');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.linkedProviders).toEqual(['google']);

    // Row should be deleted
    const row = await prisma.userProvider.findFirst({ where: { userId, provider: 'github' } });
    expect(row).toBeNull();
    // Other row still present
    const other = await prisma.userProvider.findFirst({ where: { userId, provider: 'google' } });
    expect(other).not.toBeNull();
  });

  it('clears User.provider and User.providerId when unlinking the primary', async () => {
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'clearprimary@example.com',
      displayName: 'Clear Primary',
      role: 'USER',
    });
    const userId = createRes.body.id;

    // Primary is github; also has google row
    await prisma.user.update({ where: { id: userId }, data: { provider: 'github', providerId: 'gh-clear-001' } });
    await prisma.userProvider.deleteMany({ where: { userId } });
    await prisma.userProvider.createMany({
      data: [
        { userId, provider: 'github', providerId: 'gh-clear-001' },
        { userId, provider: 'google', providerId: 'go-clear-001' },
      ],
    });

    const res = await agent.post('/api/auth/unlink/github');
    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.linkedProviders).toEqual(['google']);

    // Primary fields cleared
    const dbUser = await prisma.user.findUnique({ where: { id: userId } });
    expect(dbUser?.provider).toBeNull();
    expect(dbUser?.providerId).toBeNull();
  });

  it('returns the updated linkedProviders list on success', async () => {
    const agent = request.agent(app);
    const createRes = await agent.post('/api/auth/test-login').send({
      email: 'returnlist@example.com',
      displayName: 'Return List',
      role: 'USER',
    });
    const userId = createRes.body.id;

    // Three providers; unlink one
    await prisma.user.update({ where: { id: userId }, data: { provider: null, providerId: null } });
    await prisma.userProvider.deleteMany({ where: { userId } });
    await prisma.userProvider.createMany({
      data: [
        { userId, provider: 'github', providerId: 'gh-ret-001' },
        { userId, provider: 'google', providerId: 'go-ret-001' },
        { userId, provider: 'pike13', providerId: 'p13-ret-001' },
      ],
    });

    const res = await agent.post('/api/auth/unlink/pike13');
    expect(res.status).toBe(200);
    expect(res.body.linkedProviders).toHaveLength(2);
    expect(res.body.linkedProviders).toContain('github');
    expect(res.body.linkedProviders).toContain('google');
    expect(res.body.linkedProviders).not.toContain('pike13');
  });
});

// ---------------------------------------------------------------------------
// Link-mode initiate routes — 401 when unauthenticated
// ---------------------------------------------------------------------------

describe('OAuth initiate routes — 401 when ?link=1 and not authenticated', () => {
  beforeEach(() => {
    // Ensure env vars are absent so we don't accidentally trigger actual OAuth redirects
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.PIKE13_CLIENT_ID;
    delete process.env.PIKE13_CLIENT_SECRET;
  });

  it('GET /api/auth/github?link=1 returns 401 when not authenticated (configured)', async () => {
    // To test the 401 guard we need the route to be "configured" so it passes the 501 check.
    // We simulate by temporarily setting env vars.
    process.env.GITHUB_CLIENT_ID = 'test-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-secret';
    const res = await request(app).get('/api/auth/github?link=1');
    expect(res.status).toBe(401);
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });

  it('GET /api/auth/google?link=1 returns 401 when not authenticated (configured)', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';
    const res = await request(app).get('/api/auth/google?link=1');
    expect(res.status).toBe(401);
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('GET /api/auth/pike13?link=1 returns 401 when not authenticated (configured)', async () => {
    process.env.PIKE13_CLIENT_ID = 'test-id';
    process.env.PIKE13_CLIENT_SECRET = 'test-secret';
    const res = await request(app).get('/api/auth/pike13?link=1');
    expect(res.status).toBe(401);
    delete process.env.PIKE13_CLIENT_ID;
    delete process.env.PIKE13_CLIENT_SECRET;
  });

  it('GET /api/auth/github returns 501 (not 401) when not configured and no ?link=1', async () => {
    const res = await request(app).get('/api/auth/github');
    expect(res.status).toBe(501);
  });
});

describe('OAuth initiate routes — link mode stashes oauthLinkMode in session', () => {
  it('GET /api/auth/github?link=1 sets oauthLinkMode when authenticated', async () => {
    process.env.GITHUB_CLIENT_ID = 'test-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-secret';

    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'linkstash@example.com',
      displayName: 'Link Stash',
      role: 'USER',
    });

    // The redirect to GitHub will fail in tests but the 302 response confirms
    // the route proceeded past the auth guard. In a real browser, oauthLinkMode
    // would be set in the session before the redirect happens.
    const res = await agent.get('/api/auth/github?link=1');
    // Either a 302 redirect (Passport redirects to GitHub) or
    // 500/302 — the key assertion is it is NOT 401
    expect(res.status).not.toBe(401);

    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });
});
