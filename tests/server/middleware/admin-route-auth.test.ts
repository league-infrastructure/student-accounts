/**
 * Integration tests: admin routes protected by requireAuth + requireRole('admin').
 *
 * Scenarios:
 *   - No session   → 401 Unauthorized
 *   - role=student → 403 Forbidden
 *   - role=admin   → 200 (passes through to handler)
 *
 * These tests exercise the full Express stack via supertest, using the
 * /api/auth/test-login helper to inject a session with the correct
 * session.userId and session.role fields.
 */
import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../../server/src/app';

process.env.NODE_ENV = 'test';

// Use a stable admin route for probing — /api/admin/env is lightweight.
const ADMIN_PROBE = '/api/admin/env';

describe('Admin route middleware — unauthenticated (no session)', () => {
  it('returns 401 with { error: "Unauthorized" }', async () => {
    const res = await request(app).get(ADMIN_PROBE);
    expect(res.status).toBe(401);
    expect(res.body).toEqual({ error: 'Unauthorized' });
  });
});

describe('Admin route middleware — authenticated as student', () => {
  it('returns 403 with { error: "Forbidden" }', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'middleware-student@example.com',
      displayName: 'Middleware Student',
      role: 'student',
    });

    const res = await agent.get(ADMIN_PROBE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });
});

describe('Admin route middleware — authenticated as admin', () => {
  it('returns 200 (passes through to the route handler)', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'middleware-admin@example.com',
      displayName: 'Middleware Admin',
      role: 'admin',
    });

    const res = await agent.get(ADMIN_PROBE);
    expect(res.status).toBe(200);
  });
});

describe('Admin route middleware — authenticated as staff', () => {
  it('returns 403 (staff cannot access admin routes)', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'middleware-staff@example.com',
      displayName: 'Middleware Staff',
      role: 'staff',
    });

    const res = await agent.get(ADMIN_PROBE);
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ error: 'Forbidden' });
  });
});

describe('GET /api/auth/me — session authentication', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('returns user data when authenticated', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'me-admin@example.com',
      displayName: 'Me Admin',
      role: 'admin',
    });

    const res = await agent.get('/api/auth/me');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('id');
    expect(res.body).toHaveProperty('role');
  });
});
