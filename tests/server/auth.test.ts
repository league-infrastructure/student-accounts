import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';

import app from '../../server/src/app';

describe('Auth routes', () => {
  it('GET /api/auth/me returns 401 when not logged in', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not authenticated/i);
  });

  it('POST /api/auth/logout handles gracefully when not logged in', async () => {
    const res = await request(app).post('/api/auth/logout');
    // Should either succeed (200) or not crash — both are acceptable
    expect([200, 401]).toContain(res.status);
    if (res.status === 200) {
      expect(res.body).toHaveProperty('success', true);
    }
  });

  it('GET /api/auth/github returns 501 when env vars not configured', async () => {
    const saved = { id: process.env.GITHUB_CLIENT_ID, secret: process.env.GITHUB_CLIENT_SECRET };
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    const res = await request(app).get('/api/auth/github');
    if (saved.id) process.env.GITHUB_CLIENT_ID = saved.id;
    if (saved.secret) process.env.GITHUB_CLIENT_SECRET = saved.secret;
    expect(res.status).toBe(501);
  });

  it('GET /api/auth/google returns 501 when env vars not configured', async () => {
    const saved = { id: process.env.GOOGLE_CLIENT_ID, secret: process.env.GOOGLE_CLIENT_SECRET };
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    const res = await request(app).get('/api/auth/google');
    if (saved.id) process.env.GOOGLE_CLIENT_ID = saved.id;
    if (saved.secret) process.env.GOOGLE_CLIENT_SECRET = saved.secret;
    expect(res.status).toBe(501);
  });
});
