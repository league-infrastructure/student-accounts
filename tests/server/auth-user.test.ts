import request from 'supertest';

import app from '../../server/src/app';
import { cleanupTestDb, findUserByEmail, findUserById } from './helpers/db';

beforeAll(async () => {
  await cleanupTestDb();
}, 30000);

afterAll(async () => {
  await cleanupTestDb();
});

describe('POST /api/auth/test-login', () => {
  it('creates a user and establishes a session', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/test-login').send({
      email: 'testuser@example.com',
      displayName: 'Test User',
      role: 'USER',
    });
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body.email).toBe('testuser@example.com');
    expect(res.body.displayName).toBe('Test User');
    expect(res.body.role).toBe('USER');
  });

  it('creates an admin user when role=ADMIN', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/test-login').send({
      email: 'admin@example.com',
      displayName: 'Admin User',
      role: 'ADMIN',
    });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ADMIN');
  });

  it('defaults to test@example.com when no email provided', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/api/auth/test-login').send({});
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('test@example.com');
    expect(res.body.role).toBe('USER');
  });
});

describe('GET /api/auth/me', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns the authenticated user', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'metest@example.com',
      displayName: 'Me Test',
      role: 'USER',
    });
    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('metest@example.com');
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('role');
  });
});

describe('POST /api/auth/logout', () => {
  it('clears the session', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'logouttest@example.com',
      displayName: 'Logout Test',
    });

    const logoutRes = await agent.post('/api/auth/logout');
    expect(logoutRes.status).toBe(200);

    // After logout, /me should return 401
    const meRes = await agent.get('/api/auth/me');
    expect(meRes.status).toBe(401);
  });
});

describe('Role-based access control', () => {
  it('blocks non-admin from admin routes with 403', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'regularuser@example.com',
      displayName: 'Regular User',
      role: 'USER',
    });
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('allows admin to access admin routes', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'adminaccess@example.com',
      displayName: 'Admin Access',
      role: 'ADMIN',
    });
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });

  it('returns 401 for unauthenticated requests to admin routes', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });
});

describe('Admin user management API', () => {
  let adminAgent: any;

  beforeAll(async () => {
    adminAgent = request.agent(app);
    await adminAgent.post('/api/auth/test-login').send({
      email: 'useradmin@example.com',
      displayName: 'User Admin',
      role: 'ADMIN',
    });
  });

  it('GET /api/admin/users lists users', async () => {
    const res = await adminAgent.get('/api/admin/users');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('POST /api/admin/users creates a user', async () => {
    const res = await adminAgent.post('/api/admin/users').send({
      email: 'newuser@example.com',
      displayName: 'New User',
      role: 'USER',
    });
    expect(res.status).toBe(201);
    expect(res.body.email).toBe('newuser@example.com');
    expect(res.body.displayName).toBe('New User');
    expect(res.body).toHaveProperty('id');

    // Verify in DB
    const dbUser = await findUserByEmail('newuser@example.com');
    expect(dbUser).not.toBeNull();
    expect(dbUser!.displayName).toBe('New User');
  });

  it('POST /api/admin/users returns 400 without email', async () => {
    const res = await adminAgent.post('/api/admin/users').send({
      displayName: 'No Email',
    });
    expect(res.status).toBe(400);
  });

  it('POST /api/admin/users returns 409 for duplicate email', async () => {
    const res = await adminAgent.post('/api/admin/users').send({
      email: 'newuser@example.com',
      displayName: 'Duplicate',
    });
    expect(res.status).toBe(409);
  });

  it('PUT /api/admin/users/:id updates user role', async () => {
    const user = await findUserByEmail('newuser@example.com');
    const res = await adminAgent.put(`/api/admin/users/${user!.id}`).send({
      role: 'ADMIN',
    });
    expect(res.status).toBe(200);
    expect(res.body.role).toBe('ADMIN');

    // Verify in DB
    const updated = await findUserById(user!.id);
    expect(updated!.role).toBe('ADMIN');
  });

  it('DELETE /api/admin/users/:id deletes a user', async () => {
    const user = await findUserByEmail('newuser@example.com');
    const res = await adminAgent.delete(`/api/admin/users/${user!.id}`);
    expect(res.status).toBe(204);

    // Verify deleted in DB
    const deleted = await findUserById(user!.id);
    expect(deleted).toBeNull();
  });

  it('DELETE /api/admin/users/:id returns 404 for non-existent user', async () => {
    const res = await adminAgent.delete('/api/admin/users/999999');
    expect(res.status).toBe(404);
  });
});
