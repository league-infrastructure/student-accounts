/**
 * Pike 13 OAuth route integration tests.
 *
 * Pike 13 doesn't have a Passport strategy, so the route handles the
 * OAuth code-for-token exchange and profile fetch directly via fetch().
 * These tests stub global fetch to simulate Pike 13's responses.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser, makeLogin } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';
import app from '../../../server/src/app.js';

const SAVED_ENV: Record<string, string | undefined> = {};

async function cleanDb() {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

// Stub fetch so the route's token exchange + profile fetch resolve without
// hitting the real Pike 13 API. Each test installs its own stub.
let originalFetch: typeof fetch;

beforeAll(() => {
  SAVED_ENV.PIKE13_CLIENT_ID = process.env.PIKE13_CLIENT_ID;
  SAVED_ENV.PIKE13_CLIENT_SECRET = process.env.PIKE13_CLIENT_SECRET;
  SAVED_ENV.PIKE13_API_BASE = process.env.PIKE13_API_BASE;
  process.env.PIKE13_CLIENT_ID = 'test-pike13-client-id';
  process.env.PIKE13_CLIENT_SECRET = 'test-pike13-secret';
  process.env.PIKE13_API_BASE = 'https://test.pike13.com/api/v2/desk';
  originalFetch = globalThis.fetch;
});

afterAll(async () => {
  for (const [key, val] of Object.entries(SAVED_ENV)) {
    if (val === undefined) delete process.env[key];
    else process.env[key] = val;
  }
  globalThis.fetch = originalFetch;
  await cleanDb();
});

beforeEach(async () => {
  await cleanDb();
  globalThis.fetch = originalFetch;
});

/**
 * Install a fetch stub that handles the Pike 13 token + profile endpoints.
 * Every other URL is passed through to the original fetch.
 */
function stubPike13Fetch(profile: { id: string; email: string; name: string }) {
  globalThis.fetch = vi.fn(async (input: any, init?: any) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.includes('/oauth/token')) {
      return new Response(
        JSON.stringify({ access_token: 'test-access-token' }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    if (url.includes('/api/v2/front/people/me') || url.includes('/api/v2/me')) {
      return new Response(
        JSON.stringify({
          person: {
            id: profile.id,
            email: profile.email,
            name: profile.name,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }
    return originalFetch(input, init);
  }) as any;
}

// ---------------------------------------------------------------------------
// GET /api/auth/pike13 — initiation
// ---------------------------------------------------------------------------

describe('GET /api/auth/pike13', () => {
  it('returns 501 when PIKE13_CLIENT_ID is not set', async () => {
    const saved = process.env.PIKE13_CLIENT_ID;
    delete process.env.PIKE13_CLIENT_ID;

    const res = await request(app).get('/api/auth/pike13');
    expect(res.status).toBe(501);
    expect(res.body.error).toMatch(/not configured/i);
    expect(res.body).toHaveProperty('docs');

    process.env.PIKE13_CLIENT_ID = saved;
  });

  it('redirects to the Pike 13 authorize endpoint with the right params', async () => {
    const res = await request(app).get('/api/auth/pike13');
    expect(res.status).toBe(302);
    const loc = res.headers.location;
    expect(loc).toContain('https://test.pike13.com/oauth/authorize');
    expect(loc).toContain('response_type=code');
    expect(loc).toContain('client_id=test-pike13-client-id');
    expect(loc).toContain('redirect_uri=');
  });
});

// ---------------------------------------------------------------------------
// GET /api/auth/pike13/callback — happy paths
// ---------------------------------------------------------------------------

describe('GET /api/auth/pike13/callback — sign-in', () => {
  it('approves a returning approved user and redirects to /account', async () => {
    // Pre-seed approved user — post-Sprint-015 brand-new social_login users
    // are pending and would land on /login?error=pending_approval.
    await makeUser({
      primary_email: 'pike13-existing@example.com',
      display_name: 'Pike Existing',
    });
    stubPike13Fetch({
      id: 'pike13-uid-existing',
      email: 'pike13-existing@example.com',
      name: 'Pike Existing',
    });

    const res = await request(app).get('/api/auth/pike13/callback?code=test-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/account');
  });

  it('routes a brand-new user to /login?error=pending_approval', async () => {
    stubPike13Fetch({
      id: 'pike13-uid-newperson',
      email: 'pike13-new@example.com',
      name: 'Pike New',
    });

    const res = await request(app).get('/api/auth/pike13/callback?code=test-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?error=pending_approval');

    // Confirm the user was created as pending
    const user = await (prisma as any).user.findFirst({
      where: { primary_email: 'pike13-new@example.com' },
    });
    expect(user).not.toBeNull();
    expect(user.approval_status).toBe('pending');
  });

  it('refuses a permanently denied account with /login?error=permanently_denied', async () => {
    const banned = await makeUser({
      primary_email: 'pike13-banned@example.com',
      display_name: 'Pike Banned',
    });
    await (prisma as any).user.update({
      where: { id: banned.id },
      data: { is_active: false, approval_status: 'rejected_permanent' },
    });
    await makeLogin(banned, {
      provider: 'pike13',
      provider_user_id: 'pike13-uid-banned',
    });
    stubPike13Fetch({
      id: 'pike13-uid-banned',
      email: 'pike13-banned@example.com',
      name: 'Pike Banned',
    });

    const res = await request(app).get('/api/auth/pike13/callback?code=test-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?error=permanently_denied');

    // User stays banned
    const after = await (prisma as any).user.findUnique({ where: { id: banned.id } });
    expect(after.is_active).toBe(false);
    expect(after.approval_status).toBe('rejected_permanent');
  });

  it('reactivates a soft-denied account back into the queue on re-OAuth', async () => {
    const denied = await makeUser({
      primary_email: 'pike13-redo@example.com',
      display_name: 'Pike Redo',
    });
    await (prisma as any).user.update({
      where: { id: denied.id },
      data: { is_active: false, approval_status: 'rejected' },
    });
    await makeLogin(denied, {
      provider: 'pike13',
      provider_user_id: 'pike13-uid-redo',
    });
    stubPike13Fetch({
      id: 'pike13-uid-redo',
      email: 'pike13-redo@example.com',
      name: 'Pike Redo',
    });

    const res = await request(app).get('/api/auth/pike13/callback?code=test-code');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/login?error=pending_approval');

    const after = await (prisma as any).user.findUnique({ where: { id: denied.id } });
    expect(after.is_active).toBe(true);
    expect(after.approval_status).toBe('pending');
  });

  it('redirects to /?error=oauth_denied when the code is missing', async () => {
    const res = await request(app).get('/api/auth/pike13/callback');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/?error=oauth_denied');
  });
});
