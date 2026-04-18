/**
 * Tests for OAuth strategy find-or-create logic and initiate-route guards.
 *
 * Covers:
 *  - Initiate routes return 501 when env vars are not configured
 *  - findOrCreateOAuthUser: new identity → creates User + UserProvider
 *  - findOrCreateOAuthUser: existing (provider, providerId) → returns existing user
 *  - findOrCreateOAuthUser: new identity whose email matches existing user → auto-links
 *  - findOrCreateOAuthUser: link mode → binds to current session user
 */

import request from 'supertest';

process.env.NODE_ENV = 'test';

import app from '../../server/src/app';
import { findOrCreateOAuthUser } from '../../server/src/routes/auth';
import { prisma } from '../../server/src/services/prisma';
import { cleanupTestDb } from './helpers/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a minimal fake req object sufficient for findOrCreateOAuthUser. */
function makeReq(sessionOverrides: Record<string, any> = {}, user?: any): any {
  const session: any = { ...sessionOverrides };
  return { session, user: user ?? null };
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanupTestDb();
}, 30000);

afterAll(async () => {
  await cleanupTestDb();
});

// ---------------------------------------------------------------------------
// Initiate routes — 501 when env vars absent
// ---------------------------------------------------------------------------

describe('OAuth initiate routes — 501 when not configured', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  afterAll(() => {
    Object.assign(process.env, savedEnv);
  });

  it('GET /api/auth/github returns 501 with error and docs link', async () => {
    const res = await request(app).get('/api/auth/github');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not configured/i);
    expect(res.body).toHaveProperty('docs');
  });

  it('GET /api/auth/google returns 501 with error and docs link', async () => {
    const res = await request(app).get('/api/auth/google');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not configured/i);
    expect(res.body).toHaveProperty('docs');
  });
});

// ---------------------------------------------------------------------------
// findOrCreateOAuthUser — new identity → creates User + UserProvider
// ---------------------------------------------------------------------------

describe('findOrCreateOAuthUser — new identity (no existing user, no email match)', () => {
  it('creates a User and a UserProvider row', async () => {
    const req = makeReq();

    const user = await findOrCreateOAuthUser(
      req,
      'github',
      'gh-new-001',
      'new-oauth@example.com',
      'New OAuth User',
    );

    expect(user).toBeDefined();
    expect(user.email).toBe('new-oauth@example.com');
    expect(user.displayName).toBe('New OAuth User');
    expect(user.provider).toBe('github');
    expect(user.providerId).toBe('gh-new-001');

    const up = await prisma.userProvider.findUnique({
      where: { provider_providerId: { provider: 'github', providerId: 'gh-new-001' } },
    });
    expect(up).not.toBeNull();
    expect(up!.userId).toBe(user.id);
  });
});

// ---------------------------------------------------------------------------
// findOrCreateOAuthUser — existing (provider, providerId) → returns existing user
// ---------------------------------------------------------------------------

describe('findOrCreateOAuthUser — existing (provider, providerId)', () => {
  let existingUserId: number;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: {
        email: 'existing-oauth@example.com',
        displayName: 'Existing OAuth',
        role: 'USER',
        provider: 'github',
        providerId: 'gh-existing-001',
        providers: {
          create: { provider: 'github', providerId: 'gh-existing-001' },
        },
      },
    });
    existingUserId = u.id;
  });

  it('returns the existing user without creating a new one', async () => {
    const req = makeReq();
    const usersBefore = await prisma.user.count();

    const user = await findOrCreateOAuthUser(
      req,
      'github',
      'gh-existing-001',
      'existing-oauth@example.com',
      'Existing OAuth',
    );

    const usersAfter = await prisma.user.count();
    expect(usersAfter).toBe(usersBefore);
    expect(user.id).toBe(existingUserId);
  });
});

// ---------------------------------------------------------------------------
// findOrCreateOAuthUser — email auto-link (new identity, email matches existing user)
// ---------------------------------------------------------------------------

describe('findOrCreateOAuthUser — email auto-link', () => {
  let existingUserId: number;

  beforeAll(async () => {
    const u = await prisma.user.create({
      data: {
        email: 'autolink@example.com',
        displayName: 'Auto Link User',
        role: 'USER',
      },
    });
    existingUserId = u.id;
  });

  it('links the new OAuth identity to the existing user without creating a new User', async () => {
    const req = makeReq();
    const usersBefore = await prisma.user.count();

    const user = await findOrCreateOAuthUser(
      req,
      'google',
      'google-autolink-001',
      'autolink@example.com',
      'Auto Link User',
    );

    const usersAfter = await prisma.user.count();
    expect(usersAfter).toBe(usersBefore); // no new user created
    expect(user.id).toBe(existingUserId);

    // A UserProvider row should have been created
    const up = await prisma.userProvider.findUnique({
      where: { provider_providerId: { provider: 'google', providerId: 'google-autolink-001' } },
    });
    expect(up).not.toBeNull();
    expect(up!.userId).toBe(existingUserId);
  });
});

// ---------------------------------------------------------------------------
// findOrCreateOAuthUser — link mode
// ---------------------------------------------------------------------------

describe('findOrCreateOAuthUser — link mode', () => {
  let sessionUser: any;

  beforeAll(async () => {
    sessionUser = await prisma.user.create({
      data: {
        email: 'linkmode@example.com',
        displayName: 'Link Mode User',
        role: 'USER',
      },
    });
  });

  it('binds the new OAuth identity to the current session user', async () => {
    const req = makeReq({ oauthLinkMode: true }, sessionUser);
    const usersBefore = await prisma.user.count();

    const user = await findOrCreateOAuthUser(
      req,
      'github',
      'gh-link-001',
      'otheremail@example.com', // different email — should not create a new user
      'Some Name',
    );

    const usersAfter = await prisma.user.count();
    expect(usersAfter).toBe(usersBefore); // no new user created
    expect(user.id).toBe(sessionUser.id);

    // UserProvider row created for session user
    const up = await prisma.userProvider.findUnique({
      where: { provider_providerId: { provider: 'github', providerId: 'gh-link-001' } },
    });
    expect(up).not.toBeNull();
    expect(up!.userId).toBe(sessionUser.id);

    // oauthLinkMode cleared from session
    expect(req.session.oauthLinkMode).toBeUndefined();
  });

  it('throws 401 in link mode when no session user', async () => {
    const req = makeReq({ oauthLinkMode: true }, null);

    await expect(
      findOrCreateOAuthUser(req, 'github', 'gh-link-noauth', 'x@example.com', 'X'),
    ).rejects.toMatchObject({ status: 401 });
  });

  it('throws 409 in link mode when identity is already bound to a different user', async () => {
    // Create a second user and bind the identity to them
    const otherUser = await prisma.user.create({
      data: {
        email: 'otheruser@example.com',
        displayName: 'Other User',
        role: 'USER',
        providers: {
          create: { provider: 'github', providerId: 'gh-link-conflict-001' },
        },
      },
    });

    const req = makeReq({ oauthLinkMode: true }, sessionUser);

    await expect(
      findOrCreateOAuthUser(req, 'github', 'gh-link-conflict-001', 'x@example.com', 'X'),
    ).rejects.toMatchObject({ status: 409 });

    // Clean up
    await prisma.user.delete({ where: { id: otherUser.id } });
  });
});
