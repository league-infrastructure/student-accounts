import { Request, Response, NextFunction } from 'express';

/** Requires an authenticated user on the request. Returns 401 if not logged in. */
export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  next();
}
