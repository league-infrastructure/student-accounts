/**
 * Tests for OAuth provider linking.
 *
 * NOTE(T003): The UserProvider model and OAuth unlink endpoint were removed as
 * part of the domain schema migration (T003). The linkedProviders feature and
 * unlink endpoint will be re-implemented using the domain Login model in a
 * later sprint.
 *
 * Tests below cover only what still applies after T003:
 *  - GET /api/auth/me returns linkedProviders: [] (no providers yet)
 *  - POST /api/auth/unlink/:provider returns 401 when unauthenticated
 *  - OAuth initiate routes return 401 when ?link=1 and not authenticated
 *  - OAuth initiate routes return 501 (not 401) when not configured and no ?link=1
 */

import request from 'supertest';
import app from '../../server/src/app';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {}, 30000);

// ---------------------------------------------------------------------------
// GET /api/auth/me — linkedProviders field
// ---------------------------------------------------------------------------

describe('GET /api/auth/me — linkedProviders field', () => {
  it('returns linkedProviders: [] for a user (no Login rows yet)', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'noprovider@example.com',
      displayName: 'No Provider',
      role: 'USER',
    });

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body).toHaveProperty('linkedProviders');
    expect(meRes.body.linkedProviders).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/unlink/:provider — authentication
// ---------------------------------------------------------------------------

describe('POST /api/auth/unlink/:provider — authentication', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/auth/unlink/github');
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// Link-mode initiate routes — 401 when unauthenticated
// ---------------------------------------------------------------------------

describe('OAuth initiate routes — 401 when ?link=1 and not authenticated', () => {
  beforeEach(() => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
  });

  it('GET /api/auth/github?link=1 returns 401 when not authenticated (configured)', async () => {
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

  it('GET /api/auth/github returns 501 (not 401) when not configured and no ?link=1', async () => {
    const res = await request(app).get('/api/auth/github');
    expect(res.status).toBe(501);
  });
});

describe('OAuth initiate routes — link mode (authenticated)', () => {
  it('GET /api/auth/github?link=1 does not return 401 when authenticated', async () => {
    process.env.GITHUB_CLIENT_ID = 'test-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-secret';

    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'linkstash@example.com',
      displayName: 'Link Stash',
      role: 'USER',
    });

    const res = await agent.get('/api/auth/github?link=1');
    // Should not be 401 (auth check passed); will be 501 because OAuth not implemented (T003)
    expect(res.status).not.toBe(401);

    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });
});
