/**
 * Tests for impersonateMiddleware and requireAdmin impersonation handling.
 *
 * requireAdmin is tested as a pure unit test (no database needed).
 * impersonateMiddleware is tested via integration through the full app stack.
 */
import { vi, describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import request from 'supertest';
import app from '../../server/src/app';
import { requireAdmin } from '../../server/src/middleware/requireAdmin';
import { prisma } from '../../server/src/services/prisma';

// Set test environment
process.env.NODE_ENV = 'test';

// =============================================================================
// Helpers
// =============================================================================

function makeMockReq(overrides: Record<string, any> = {}): Request {
  return {
    session: {},
    user: undefined,
    realAdmin: undefined,
    ...overrides,
  } as unknown as Request;
}

function makeMockRes(): Response {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return res as Response;
}

// =============================================================================
// requireAdmin — pure unit tests (no database needed)
// =============================================================================

describe('requireAdmin (unit)', () => {
  it('allows request when req.user.role === ADMIN (no impersonation)', () => {
    const req = makeMockReq({
      user: { id: 1, role: 'ADMIN' },
      session: {},
    });
    const res = makeMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  it('rejects request when req.user.role is USER and no realAdmin', () => {
    const req = makeMockReq({
      user: { id: 2, role: 'USER' },
      session: {},
    });
    const res = makeMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
  });

  it('rejects with 401 when neither req.user nor req.session.isAdmin is set', () => {
    const req = makeMockReq({ user: undefined, session: {} });
    const res = makeMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({ error: 'Authentication required' });
  });

  /**
   * Core impersonation scenario: admin impersonates a non-admin user.
   * req.realAdmin (the original admin) is present, req.user is the target (USER role).
   * requireAdmin must allow the request because the real admin is ADMIN.
   */
  it('allows request when req.realAdmin.role === ADMIN even if req.user.role === USER', () => {
    const req = makeMockReq({
      user: { id: 99, role: 'USER' },
      realAdmin: { id: 10, role: 'ADMIN' },
      session: {},
    });
    const res = makeMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(res.status).not.toHaveBeenCalled();
  });

  /**
   * Edge case: req.realAdmin is set but is also not an ADMIN (should not happen
   * in practice, but the guard must still reject).
   */
  it('rejects with 403 when req.realAdmin exists but does not have ADMIN role', () => {
    const req = makeMockReq({
      user: { id: 99, role: 'USER' },
      realAdmin: { id: 10, role: 'USER' },
      session: {},
    });
    const res = makeMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(403);
    expect(res.json).toHaveBeenCalledWith({ error: 'Admin access required' });
  });

  it('allows access via legacy session.isAdmin when user is not set', () => {
    const req = makeMockReq({
      user: undefined,
      session: { isAdmin: true },
    });
    const res = makeMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});

// =============================================================================
// Integration tests — impersonateMiddleware wired in app.ts, real DB
// =============================================================================

describe('Impersonation integration via app', () => {
  let adminId: number;
  let targetUserId: number;

  beforeAll(async () => {
    // Create admin and target user in the test DB
    const admin = await prisma.user.upsert({
      where: { email: 'imp-admin@example.com' },
      update: { role: 'ADMIN' },
      create: {
        email: 'imp-admin@example.com',
        displayName: 'Imp Admin',
        role: 'ADMIN',
        provider: 'test',
        providerId: 'test-imp-admin',
      },
    });
    adminId = admin.id;

    const target = await prisma.user.upsert({
      where: { email: 'imp-target@example.com' },
      update: { role: 'USER' },
      create: {
        email: 'imp-target@example.com',
        displayName: 'Imp Target',
        role: 'USER',
        provider: 'test',
        providerId: 'test-imp-target',
      },
    });
    targetUserId = target.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { email: { in: ['imp-admin@example.com', 'imp-target@example.com'] } },
    });
  });

  it('no impersonation: req.user is the logged-in user, req.realAdmin is absent', async () => {
    // Without impersonation, /api/auth/me returns the logged-in user's data.
    // If realAdmin were leaking, the response would differ.
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'imp-admin@example.com',
      displayName: 'Imp Admin',
      role: 'ADMIN',
    });
    const me = await agent.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.email).toBe('imp-admin@example.com');
    expect(me.body.role).toBe('ADMIN');
  });

  it('admin can access admin routes when logged in normally', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'imp-admin@example.com',
      displayName: 'Imp Admin',
      role: 'ADMIN',
    });
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);
  });

  it('regular user is blocked from admin routes (403)', async () => {
    const agent = request.agent(app);
    await agent.post('/api/auth/test-login').send({
      email: 'imp-target@example.com',
      displayName: 'Imp Target',
      role: 'USER',
    });
    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Admin access required');
  });

  it('unauthenticated request is rejected with 401', async () => {
    const res = await request(app).get('/api/admin/users');
    expect(res.status).toBe(401);
  });

  /**
   * Full impersonation flow: admin logs in, session gets impersonatingUserId set,
   * impersonateMiddleware swaps req.user. The admin should still access admin routes
   * because requireAdmin checks req.realAdmin.role.
   *
   * We simulate the session mutation by using a test endpoint that sets
   * session.impersonatingUserId directly. Since ticket 008 (impersonation API)
   * doesn't exist yet, we use the test-login flow and manually set session state
   * via a helper route registered only in test mode, or we verify the middleware
   * behavior through the unit tests above.
   *
   * The following test verifies the impersonation path by directly calling
   * impersonateMiddleware with a mock that uses the real prisma.
   */
  it('impersonateMiddleware swaps req.user and preserves realAdmin', async () => {
    const { impersonateMiddleware } = await import('../../server/src/middleware/impersonate');

    const req = makeMockReq({
      user: { id: adminId, role: 'ADMIN' },
      session: { impersonatingUserId: targetUserId },
    });
    const res = makeMockRes();
    const next = vi.fn();

    await impersonateMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    // req.user is now the target (non-admin) user
    expect((req.user as any).email).toBe('imp-target@example.com');
    expect((req.user as any).role).toBe('USER');
    // req.realAdmin is the original admin object that was previously req.user
    expect((req as any).realAdmin.role).toBe('ADMIN');
  });

  it('requireAdmin allows access when req.realAdmin is ADMIN and req.user is USER (impersonation)', () => {
    // This is the critical path: admin impersonates a non-admin user,
    // but requireAdmin should still grant access.
    const req = makeMockReq({
      user: { id: targetUserId, role: 'USER' },
      realAdmin: { id: adminId, role: 'ADMIN' },
      session: {},
    });
    const res = makeMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
