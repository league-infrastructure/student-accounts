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

  it('allows request when req.user.role === admin (domain enum)', () => {
    const req = makeMockReq({
      user: { id: 1, role: 'admin' },
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

  it('allows request when req.realAdmin.role === admin (domain enum)', () => {
    const req = makeMockReq({
      user: { id: 99, role: 'student' },
      realAdmin: { id: 10, role: 'admin' },
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
    // Create admin and target user in the test DB using domain schema
    const admin = await prisma.user.upsert({
      where: { primary_email: 'imp-admin@example.com' },
      update: { role: 'admin' },
      create: {
        primary_email: 'imp-admin@example.com',
        display_name: 'Imp Admin',
        role: 'admin',
        created_via: 'admin_created',
      },
    });
    adminId = admin.id;

    const target = await prisma.user.upsert({
      where: { primary_email: 'imp-target@example.com' },
      update: { role: 'student' },
      create: {
        primary_email: 'imp-target@example.com',
        display_name: 'Imp Target',
        role: 'student',
        created_via: 'admin_created',
      },
    });
    targetUserId = target.id;
  });

  afterAll(async () => {
    await prisma.user.deleteMany({
      where: { primary_email: { in: ['imp-admin@example.com', 'imp-target@example.com'] } },
    });
  });

  it('no impersonation: req.user is the logged-in user, req.realAdmin is absent', async () => {
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
   * Full impersonation flow via impersonateMiddleware with mock using real prisma.
   */
  it('impersonateMiddleware swaps req.user and preserves realAdmin', async () => {
    const { impersonateMiddleware } = await import('../../server/src/middleware/impersonate');

    const req = makeMockReq({
      user: { id: adminId, role: 'admin' },
      session: { impersonatingUserId: targetUserId },
    });
    const res = makeMockRes();
    const next = vi.fn();

    await impersonateMiddleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    // req.user is now the target (non-admin) user
    expect((req.user as any).primary_email).toBe('imp-target@example.com');
    expect((req.user as any).role).toBe('student');
    // req.realAdmin is the original admin object that was previously req.user
    expect((req as any).realAdmin.role).toBe('admin');
  });

  it('requireAdmin allows access when req.realAdmin is admin and req.user is student (impersonation)', () => {
    const req = makeMockReq({
      user: { id: targetUserId, role: 'student' },
      realAdmin: { id: adminId, role: 'admin' },
      session: {},
    });
    const res = makeMockRes();
    const next = vi.fn();

    requireAdmin(req, res, next);

    expect(next).toHaveBeenCalledOnce();
  });
});
