/**
 * Tests for POST /api/auth/demo-login
 *
 * Verifies hardcoded credential pairs, session establishment,
 * role assignment, and error cases.
 */
import request from 'supertest';

process.env.NODE_ENV = 'test';

import app from '../../server/src/app';
import { cleanupTestDb } from './helpers/db';
import { prisma } from '../../server/src/services/prisma';

beforeAll(async () => {
  // Remove any leftover demo users from previous test runs
  await prisma.user.deleteMany({
    where: { email: { in: ['user@demo.local', 'admin@demo.local'] } },
  });
}, 30000);

afterAll(async () => {
  await prisma.user.deleteMany({
    where: { email: { in: ['user@demo.local', 'admin@demo.local'] } },
  });
  await cleanupTestDb();
});

describe('POST /api/auth/demo-login — valid credentials', () => {
  it('user/pass returns 200 with USER role', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ username: 'user', password: 'pass' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('user@demo.local');
    expect(res.body.user.role).toBe('USER');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user.displayName).toBe('Demo User');
  });

  it('user/pass sets a session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ username: 'user', password: 'pass' });

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    // At least one cookie should be set (the session cookie)
    const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
    expect(cookieArray.length).toBeGreaterThan(0);
  });

  it('admin/admin returns 200 with ADMIN role', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ username: 'admin', password: 'admin' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('admin@demo.local');
    expect(res.body.user.role).toBe('ADMIN');
    expect(res.body.user).toHaveProperty('id');
    expect(res.body.user.displayName).toBe('Demo Admin');
  });

  it('admin/admin sets a session cookie', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ username: 'admin', password: 'admin' });

    expect(res.status).toBe(200);
    const cookies = res.headers['set-cookie'];
    expect(cookies).toBeDefined();
    const cookieArray = Array.isArray(cookies) ? cookies : [cookies];
    expect(cookieArray.length).toBeGreaterThan(0);
  });
});

describe('POST /api/auth/demo-login — session persistence with /me', () => {
  it('after user/pass login, GET /api/auth/me returns USER', async () => {
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/api/auth/demo-login')
      .send({ username: 'user', password: 'pass' });
    expect(loginRes.status).toBe(200);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe('user@demo.local');
    expect(meRes.body.role).toBe('USER');
    expect(meRes.body).toHaveProperty('id');
  });

  it('after admin/admin login, GET /api/auth/me returns ADMIN', async () => {
    const agent = request.agent(app);

    const loginRes = await agent
      .post('/api/auth/demo-login')
      .send({ username: 'admin', password: 'admin' });
    expect(loginRes.status).toBe(200);

    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(200);
    expect(meRes.body.email).toBe('admin@demo.local');
    expect(meRes.body.role).toBe('ADMIN');
  });
});

describe('POST /api/auth/demo-login — invalid credentials', () => {
  it('user/wrong returns 401 with error message', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ username: 'user', password: 'wrong' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'Invalid credentials');
  });

  it('unknown/pass returns 401 with error message', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ username: 'unknown', password: 'pass' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error', 'Invalid credentials');
  });
});

describe('POST /api/auth/demo-login — missing body fields', () => {
  it('returns 400 when username is missing', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ password: 'pass' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when password is missing', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({ username: 'user' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 400 when body is empty', async () => {
    const res = await request(app)
      .post('/api/auth/demo-login')
      .send({});

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('POST /api/auth/demo-login — find-or-create idempotency', () => {
  it('calling demo-login twice with same credentials does not create duplicate users', async () => {
    const agent1 = request.agent(app);
    const agent2 = request.agent(app);

    const res1 = await agent1
      .post('/api/auth/demo-login')
      .send({ username: 'user', password: 'pass' });
    const res2 = await agent2
      .post('/api/auth/demo-login')
      .send({ username: 'user', password: 'pass' });

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    // Same user ID — no duplicate created
    expect(res1.body.user.id).toBe(res2.body.user.id);
  });
});
