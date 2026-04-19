/**
 * Unit tests for requireAuth middleware.
 *
 * requireAuth checks req.session.userId.
 * - Present → next() is called.
 * - Absent  → 401 JSON { error: 'Unauthorized' }.
 */
import { describe, it, expect, vi } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../../server/src/middleware/requireAuth';

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
// Tests
// ---------------------------------------------------------------------------

describe('requireAuth', () => {
  it('calls next() when session.userId is set', () => {
    const req = makeMockReq({ userId: 42 });
    const { res, status } = makeMockRes();
    const next: NextFunction = vi.fn();

    requireAuth(req, res, next);

    expect(next).toHaveBeenCalledOnce();
    expect(status).not.toHaveBeenCalled();
  });

  it('returns 401 when session.userId is absent', () => {
    const req = makeMockReq({});
    const { res, status, json } = makeMockRes();
    const next: NextFunction = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns 401 when session.userId is null', () => {
    const req = makeMockReq({ userId: null });
    const { res, status, json } = makeMockRes();
    const next: NextFunction = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns 401 when session.userId is 0 (falsy)', () => {
    // userId=0 is treated as absent — no valid user has id 0.
    const req = makeMockReq({ userId: 0 });
    const { res, status, json } = makeMockRes();
    const next: NextFunction = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });

  it('returns 401 when session object is empty', () => {
    const req = { session: {} } as unknown as Request;
    const { res, status, json } = makeMockRes();
    const next: NextFunction = vi.fn();

    requireAuth(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith({ error: 'Unauthorized' });
  });
});
