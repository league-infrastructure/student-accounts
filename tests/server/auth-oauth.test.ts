/**
 * OAuth strategy find-or-create tests.
 *
 * NOTE(T003): The findOrCreateOAuthUser function and UserProvider model were
 * removed as part of the domain schema migration (T003). The OAuth flow will
 * be re-implemented using the domain Login model in a later sprint.
 *
 * The tests below cover only what still applies: OAuth initiate-route 501
 * responses when env vars are absent.
 *
 * Full OAuth tests will be restored when the Login-based OAuth flow is
 * implemented (see architecture Login model section).
 */

import request from 'supertest';

process.env.NODE_ENV = 'test';

import app from '../../server/src/app';

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
