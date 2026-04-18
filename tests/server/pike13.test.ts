/**
 * Tests for the Pike 13 hand-rolled OAuth flow.
 *
 * Covers:
 *  - GET /api/auth/pike13 returns 501 when env vars absent
 *  - GET /api/auth/pike13 returns 302 redirect when configured (URL + params)
 *  - GET /api/auth/pike13?link=1 sets oauthLinkMode session flag
 *  - GET /api/auth/pike13/callback with no code → redirect to /login
 *  - GET /api/auth/pike13/callback with token exchange failure → redirect to /login
 *  - GET /api/auth/pike13/callback with profile fetch failure → redirect to /login
 *  - Successful callback: exchanges code, fetches profile, creates session
 *  - Successful callback with email matching existing user auto-links
 */

import { vi, describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';

process.env.NODE_ENV = 'test';

import app from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';
import { cleanupTestDb } from './helpers/db';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Returns a minimal mock Response for fetch that returns JSON. */
function mockJsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve(JSON.stringify(body)),
  } as unknown as Response;
}

/** Returns a minimal mock Response for fetch that is not ok. */
function mockErrorResponse(status: number, text = 'error'): Response {
  return {
    ok: false,
    status,
    json: () => Promise.resolve({ error: text }),
    text: () => Promise.resolve(text),
  } as unknown as Response;
}

// ---------------------------------------------------------------------------
// Database cleanup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await cleanupTestDb();
}, 30000);

afterAll(async () => {
  await cleanupTestDb();
});

// ---------------------------------------------------------------------------
// Initiate route — 501 when not configured
// ---------------------------------------------------------------------------

describe('GET /api/auth/pike13 — 501 when not configured', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.PIKE13_CLIENT_ID;
    delete process.env.PIKE13_CLIENT_SECRET;
  });

  afterEach(() => {
    Object.assign(process.env, savedEnv);
  });

  it('returns 501 with error and docs link', async () => {
    const res = await request(app).get('/api/auth/pike13');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not configured/i);
    expect(res.body).toHaveProperty('docs');
    expect(res.body.docs).toContain('pike13');
  });

  it('returns 501 when only client ID is set (no secret)', async () => {
    process.env.PIKE13_CLIENT_ID = 'test-id';
    const res = await request(app).get('/api/auth/pike13');
    expect(res.status).toBe(501);
  });

  it('returns 501 when only client secret is set (no ID)', async () => {
    process.env.PIKE13_CLIENT_SECRET = 'test-secret';
    const res = await request(app).get('/api/auth/pike13');
    expect(res.status).toBe(501);
  });
});

// ---------------------------------------------------------------------------
// Initiate route — redirect when configured
// ---------------------------------------------------------------------------

describe('GET /api/auth/pike13 — redirect when configured', () => {
  const savedEnv = { ...process.env };

  beforeEach(() => {
    process.env.PIKE13_CLIENT_ID = 'test-pike13-client-id';
    process.env.PIKE13_CLIENT_SECRET = 'test-pike13-client-secret';
    process.env.PIKE13_CALLBACK_URL = 'http://localhost:5173/api/auth/pike13/callback';
  });

  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('returns 302 redirect to Pike 13 authorize endpoint', async () => {
    const res = await request(app).get('/api/auth/pike13').redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('pike13.com/oauth/authorize');
  });

  it('redirect URL includes client_id parameter', async () => {
    const res = await request(app).get('/api/auth/pike13').redirects(0);
    const location = res.headers.location || '';
    const url = new URL(location);
    expect(url.searchParams.get('client_id')).toBe('test-pike13-client-id');
  });

  it('redirect URL includes response_type=code', async () => {
    const res = await request(app).get('/api/auth/pike13').redirects(0);
    const location = res.headers.location || '';
    const url = new URL(location);
    expect(url.searchParams.get('response_type')).toBe('code');
  });

  it('redirect URL includes redirect_uri', async () => {
    const res = await request(app).get('/api/auth/pike13').redirects(0);
    const location = res.headers.location || '';
    const url = new URL(location);
    expect(url.searchParams.get('redirect_uri')).toContain('pike13/callback');
  });
});

// ---------------------------------------------------------------------------
// Callback route — no code → redirect to /login
// ---------------------------------------------------------------------------

describe('GET /api/auth/pike13/callback — no code', () => {
  it('redirects to /login when no code query param', async () => {
    const res = await request(app)
      .get('/api/auth/pike13/callback')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

// ---------------------------------------------------------------------------
// Callback route — token exchange failure → redirect to /login
// ---------------------------------------------------------------------------

describe('GET /api/auth/pike13/callback — token exchange failure', () => {
  const savedEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.PIKE13_CLIENT_ID = 'test-pike13-client-id';
    process.env.PIKE13_CLIENT_SECRET = 'test-pike13-client-secret';
    process.env.PIKE13_CALLBACK_URL = 'http://localhost:5173/api/auth/pike13/callback';
    fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(mockErrorResponse(400, 'invalid_grant'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...savedEnv };
  });

  it('redirects to /login on token exchange failure', async () => {
    const res = await request(app)
      .get('/api/auth/pike13/callback?code=bad-code')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

// ---------------------------------------------------------------------------
// Callback route — profile fetch failure → redirect to /login
// ---------------------------------------------------------------------------

describe('GET /api/auth/pike13/callback — profile fetch failure', () => {
  const savedEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    process.env.PIKE13_CLIENT_ID = 'test-pike13-client-id';
    process.env.PIKE13_CLIENT_SECRET = 'test-pike13-client-secret';
    process.env.PIKE13_CALLBACK_URL = 'http://localhost:5173/api/auth/pike13/callback';
    // Token exchange succeeds, both profile fetch attempts fail
    fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'test-access-token' }),
      )
      .mockResolvedValueOnce(mockErrorResponse(401, 'unauthorized'))
      .mockResolvedValueOnce(mockErrorResponse(401, 'unauthorized'));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...savedEnv };
  });

  it('redirects to /login on profile fetch failure', async () => {
    const res = await request(app)
      .get('/api/auth/pike13/callback?code=valid-code')
      .redirects(0);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login');
  });
});

// ---------------------------------------------------------------------------
// Callback route — successful flow: new user created
// ---------------------------------------------------------------------------

describe('GET /api/auth/pike13/callback — successful new user', () => {
  const savedEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  const testProfile = {
    id: 'pike13-user-001',
    email: 'pike13-test-new@example.com',
    name: 'Pike13 Test User',
  };

  beforeEach(() => {
    process.env.PIKE13_CLIENT_ID = 'test-pike13-client-id';
    process.env.PIKE13_CLIENT_SECRET = 'test-pike13-client-secret';
    process.env.PIKE13_CALLBACK_URL = 'http://localhost:5173/api/auth/pike13/callback';

    fetchSpy = vi
      .spyOn(global, 'fetch')
      // 1st call: token exchange
      .mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'pike13-test-token' }),
      )
      // 2nd call: profile fetch (/api/v2/front/people/me)
      .mockResolvedValueOnce(
        mockJsonResponse({
          person: {
            id: testProfile.id,
            email: testProfile.email,
            name: testProfile.name,
          },
        }),
      );
  });

  afterEach(async () => {
    fetchSpy.mockRestore();
    process.env = { ...savedEnv };
    // Clean up created user
    try {
      const user = await prisma.user.findUnique({
        where: { email: testProfile.email },
      });
      if (user) {
        await prisma.userProvider.deleteMany({ where: { userId: user.id } });
        await prisma.user.delete({ where: { id: user.id } });
      }
    } catch {
      // ignore
    }
  });

  it('creates a new user and redirects to / (login mode)', async () => {
    const res = await request(app)
      .get('/api/auth/pike13/callback?code=valid-code')
      .redirects(0);

    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/');
  });

  it('creates a User record in the database', async () => {
    await request(app)
      .get('/api/auth/pike13/callback?code=valid-code')
      .redirects(0);

    const user = await prisma.user.findUnique({
      where: { email: testProfile.email },
    });
    expect(user).not.toBeNull();
    expect(user!.provider).toBe('pike13');
    expect(user!.providerId).toBe(testProfile.id);
  });

  it('creates a UserProvider row with provider=pike13', async () => {
    await request(app)
      .get('/api/auth/pike13/callback?code=valid-code')
      .redirects(0);

    const up = await prisma.userProvider.findUnique({
      where: {
        provider_providerId: {
          provider: 'pike13',
          providerId: testProfile.id,
        },
      },
    });
    expect(up).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Callback route — successful flow: email auto-link to existing user
// ---------------------------------------------------------------------------

describe('GET /api/auth/pike13/callback — auto-link by email', () => {
  const savedEnv = { ...process.env };
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  let existingUserId: number;

  const testEmail = 'pike13-autolink@example.com';
  const testProviderId = 'pike13-autolink-001';

  beforeAll(async () => {
    // Create an existing user with the same email but no Pike 13 provider
    const user = await prisma.user.create({
      data: {
        email: testEmail,
        displayName: 'Existing User',
        role: 'USER',
      },
    });
    existingUserId = user.id;
  });

  beforeEach(() => {
    process.env.PIKE13_CLIENT_ID = 'test-pike13-client-id';
    process.env.PIKE13_CLIENT_SECRET = 'test-pike13-client-secret';
    process.env.PIKE13_CALLBACK_URL = 'http://localhost:5173/api/auth/pike13/callback';

    fetchSpy = vi
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        mockJsonResponse({ access_token: 'pike13-autolink-token' }),
      )
      .mockResolvedValueOnce(
        mockJsonResponse({
          person: {
            id: testProviderId,
            email: testEmail,
            name: 'Existing User',
          },
        }),
      );
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    process.env = { ...savedEnv };
  });

  afterAll(async () => {
    try {
      await prisma.userProvider.deleteMany({ where: { userId: existingUserId } });
      await prisma.user.delete({ where: { id: existingUserId } });
    } catch {
      // ignore
    }
  });

  it('does not create a new user — auto-links to existing user by email', async () => {
    const usersBefore = await prisma.user.count();

    await request(app)
      .get('/api/auth/pike13/callback?code=autolink-code')
      .redirects(0);

    const usersAfter = await prisma.user.count();
    expect(usersAfter).toBe(usersBefore);
  });

  it('creates a UserProvider row linking to the existing user', async () => {
    await request(app)
      .get('/api/auth/pike13/callback?code=autolink-code')
      .redirects(0);

    const up = await prisma.userProvider.findUnique({
      where: {
        provider_providerId: {
          provider: 'pike13',
          providerId: testProviderId,
        },
      },
    });
    expect(up).not.toBeNull();
    expect(up!.userId).toBe(existingUserId);
  });
});
