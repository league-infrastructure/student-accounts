import { Request, Response, NextFunction } from 'express';

/**
 * requireAuth — session-based authentication guard.
 *
 * Checks req.session.userId. If absent, returns 401.
 * If present, calls next().
 *
 * Must be used before requireRole in any middleware chain.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const sessionUserId = (req.session as any).userId;
  if (!sessionUserId) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
}
