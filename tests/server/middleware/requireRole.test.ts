/**
 * Unit tests for requireRole middleware factory.
 *
 * requireRole(...roles) returns a middleware that checks req.session.role.
 * - role in allowed list  → next() is called.
 * - role not in list      → 403 JSON { error: 'Forbidden' }.
 * - role absent           → 403 JSON { error: 'Forbidden' }.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireRole } from '../../../server/src/middleware/requireRole';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeMockReq(sessionOverrides: Record<string, any> = {}): Request {
  return {
    session: { ...sessionOverrides },
  } as unknown as Request;
}

function makeMockRes(): { res: Response; status: ReturnType<typeof vi.fn>; json: ReturnType<typeof vi.fn> } {
  const res: any = {};
  res.status = vi.fn().mockReturnValue(res);
  res.json = vi.fn().mockReturnValue(res);
  return { res: res as Response, status: res.status, json: res.json };
}

// ---------------------------------------------------------------------------
// Tests — single-role guard
// ---------------------------------------------------------------------------

describe('requireRole — single role', () => {
  it('calls next() when session.role matches the required role', () => {
    const middleware = requireRole('admin');
    const req = makeMockReq({ role: 'admin' });
    const { res, status } = makeMockRes();
    const next: NextFunction = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('returns 403 when session.role does not match', () => {
    const middleware = requireRole('admin');
    const req = makeMockReq({ role: 'student' });
    const { res, status, json } = makeMockRes();
    const next: NextFunction = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('returns 403 when session.role is absent', () => {
    const middleware = requireRole('admin');
    const req = makeMockReq({});
    const { res, status, json } = makeMockRes();
    const next: NextFunction = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('returns 403 when session.role is null', () => {
    const middleware = requireRole('admin');
    const req = makeMockReq({ role: null });
    const { res, status, json } = makeMockRes();
    const next: NextFunction = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });
});

// ---------------------------------------------------------------------------
// Tests — multi-role guard
// ---------------------------------------------------------------------------

describe('requireRole — multiple roles', () => {
  it('calls next() when session.role is in the allowed set (staff)', () => {
    const middleware = requireRole('staff', 'admin');
    const req = makeMockReq({ role: 'staff' });
    const { res, status } = makeMockRes();
    const next: NextFunction = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('calls next() when session.role is in the allowed set (admin)', () => {
    const middleware = requireRole('staff', 'admin');
    const req = makeMockReq({ role: 'admin' });
    const { res, status } = makeMockRes();
    const next: NextFunction = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('returns 403 when session.role is not in the allowed set', () => {
    const middleware = requireRole('staff', 'admin');
    const req = makeMockReq({ role: 'student' });
    const { res, status, json } = makeMockRes();
    const next: NextFunction = vi.fn();

    middleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });
});

// ---------------------------------------------------------------------------
// Tests — composition with requireAuth (simulated)
// ---------------------------------------------------------------------------

describe('requireRole — chained after requireAuth', () => {
  it('applies role check independently after auth check passes', () => {
    // Simulate: requireAuth already ran and called next(), now requireRole runs.
    const middleware = requireRole('admin');
    const req = makeMockReq({ userId: 1, role: 'student' });
    const { res, status, json } = makeMockRes();
    const next: NextFunction = vi.fn();

    middleware(req, res, next);

    // role=student should be forbidden from admin
    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith({ error: 'Forbidden' });
  });

  it('passes through when both userId and correct role are in session', () => {
    const middleware = requireRole('admin');
    const req = makeMockReq({ userId: 1, role: 'admin' });
    const { res, status } = makeMockRes();
    const next: NextFunction = vi.fn();

    middleware(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });
});
