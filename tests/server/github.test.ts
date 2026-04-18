import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';

import app from '../../server/src/app';

describe('GitHub repos proxy (no credentials configured)', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('GET /api/github/repos returns 501 when GitHub not configured', async () => {
    const res = await request(app).get('/api/github/repos');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not configured/i);
  });

  it('GET /api/github/repos 501 includes docs URL', async () => {
    const res = await request(app).get('/api/github/repos');
    expect(res.status).toBe(501);
    expect(res.body).toHaveProperty('docs');
    expect(res.body.docs).toContain('github.com');
  });

  it('GET /api/github/repos returns 401 when not authenticated (but configured)', async () => {
    process.env.GITHUB_CLIENT_ID = 'test-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-secret';

    const res = await request(app).get('/api/github/repos');
    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/not authenticated/i);
  });
});
