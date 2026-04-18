import request from 'supertest';

// Set test environment before importing app
process.env.NODE_ENV = 'test';

import app from '../../server/src/app';

describe('GET /api/integrations/status', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    // Restore original env before each test
    process.env = { ...originalEnv };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('returns all services with configured: false when no env vars set', async () => {
    delete process.env.GITHUB_CLIENT_ID;
    delete process.env.GITHUB_CLIENT_SECRET;
    delete process.env.GOOGLE_CLIENT_ID;
    delete process.env.GOOGLE_CLIENT_SECRET;
    delete process.env.PIKE13_ACCESS_TOKEN;
    delete process.env.GITHUB_TOKEN;
    delete process.env.ANTHROPIC_API_KEY;
    delete process.env.OPENAI_API_KEY;

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      github: { configured: false },
      google: { configured: false },
      pike13: { configured: false },
      githubToken: { configured: false },
      anthropic: { configured: false },
      openai: { configured: false },
    });
  });

  it('reports github configured when both client ID and secret are set', async () => {
    process.env.GITHUB_CLIENT_ID = 'test-id';
    process.env.GITHUB_CLIENT_SECRET = 'test-secret';

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.github.configured).toBe(true);
  });

  it('reports google configured when both client ID and secret are set', async () => {
    process.env.GOOGLE_CLIENT_ID = 'test-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-secret';

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.google.configured).toBe(true);
  });

  it('reports pike13 configured when access token is set', async () => {
    process.env.PIKE13_ACCESS_TOKEN = 'test-token';

    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);
    expect(res.body.pike13.configured).toBe(true);
  });

  it('never exposes actual secret values in the response', async () => {
    process.env.GITHUB_CLIENT_ID = 'gh-id-12345';
    process.env.GITHUB_CLIENT_SECRET = 'gh-secret-67890';
    process.env.GOOGLE_CLIENT_ID = 'google-id-12345';
    process.env.GOOGLE_CLIENT_SECRET = 'google-secret-67890';
    process.env.PIKE13_ACCESS_TOKEN = 'pike-token-12345';

    const res = await request(app).get('/api/integrations/status');
    const body = JSON.stringify(res.body);

    expect(body).not.toContain('gh-id-12345');
    expect(body).not.toContain('gh-secret-67890');
    expect(body).not.toContain('google-id-12345');
    expect(body).not.toContain('google-secret-67890');
    expect(body).not.toContain('pike-token-12345');
  });

  it('response shape includes all six services with configured boolean', async () => {
    const res = await request(app).get('/api/integrations/status');
    expect(res.status).toBe(200);

    const keys = Object.keys(res.body);
    const expectedServices = ['github', 'google', 'pike13', 'githubToken', 'anthropic', 'openai'];
    expect(keys).toEqual(expect.arrayContaining(expectedServices));
    expect(keys).toHaveLength(expectedServices.length);

    for (const service of expectedServices) {
      expect(Object.keys(res.body[service])).toEqual(['configured']);
      expect(typeof res.body[service].configured).toBe('boolean');
    }
  });
});
