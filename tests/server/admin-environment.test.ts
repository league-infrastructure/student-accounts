import request from 'supertest';

process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgresql://app:devpassword@localhost:5433/app';

import app from '../../server/src/app';

describe('Admin Environment API', () => {
  let adminAgent: any;

  beforeAll(async () => {
    adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/test-login').send({
      email: 'env-admin@example.com',
      displayName: 'Env Admin',
      role: 'ADMIN',
    });
  }, 30000);

  it('GET /api/admin/env returns environment info', async () => {
    const res = await adminAgent.get('/api/admin/env');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('node');
    expect(res.body).toHaveProperty('uptime');
    expect(res.body).toHaveProperty('memory');
    expect(res.body).toHaveProperty('deployment');
    expect(res.body).toHaveProperty('database');
    expect(res.body).toHaveProperty('integrations');
  });

  it('response includes integrations object with configured booleans', async () => {
    const res = await adminAgent.get('/api/admin/env');
    expect(res.status).toBe(200);

    const integrations = res.body.integrations;
    expect(typeof integrations).toBe('object');

    // Each integration should have a 'configured' boolean
    expect(integrations.github).toHaveProperty('configured');
    expect(typeof integrations.github.configured).toBe('boolean');
    expect(integrations.google).toHaveProperty('configured');
    expect(typeof integrations.google.configured).toBe('boolean');
    expect(integrations.pike13).toHaveProperty('configured');
    expect(typeof integrations.pike13.configured).toBe('boolean');
    expect(integrations.anthropic).toHaveProperty('configured');
    expect(typeof integrations.anthropic.configured).toBe('boolean');
  });

  it('returns 403 for non-admin', async () => {
    const userAgent = request.agent(app);
    await userAgent.post('/api/auth/test-login').send({
      email: 'env-user@example.com',
      displayName: 'Env User',
      role: 'USER',
    });
    const res = await userAgent.get('/api/admin/env');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('returns 401 for unauthenticated', async () => {
    const res = await request(app).get('/api/admin/env');
    expect(res.status).toBe(401);
  });
});
