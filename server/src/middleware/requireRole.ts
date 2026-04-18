import { Request, Response, NextFunction, RequestHandler } from 'express';

type UserRole = 'student' | 'staff' | 'admin';

/**
 * requireRole — session-based role guard.
 *
 * Returns a middleware that checks req.session.role against the allowed roles.
 * If the role is not in the allowed list, responds with 403.
 *
 * Must be used after requireAuth (which ensures req.session.userId is set).
 *
 * Usage:
 *   router.get('/staff/directory', requireAuth, requireRole('staff', 'admin'), handler);
 */
export function requireRole(...roles: UserRole[]): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const role = (req.session as any).role as UserRole | undefined;
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: 'Forbidden' });
    }
    next();
  };
}
