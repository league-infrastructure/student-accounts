import { Request, Response, NextFunction } from 'express';

declare module 'express-session' {
  interface SessionData {
    isAdmin?: boolean;
  }
}

/** Requires an authenticated user with ADMIN role. Returns 401 or 403.
 *
 * When an admin is impersonating another user, req.realAdmin holds the actual
 * admin's identity. We check the real admin's role so that admin-only routes
 * remain accessible during impersonation, even if the impersonated user is not
 * an admin.
 *
 * NOTE: Accepts both legacy role string 'ADMIN' and domain enum value 'admin'
 * for compatibility during the schema migration (T003). T008 will normalize this.
 */
function isAdmin(role: string | undefined): boolean {
  return role === 'ADMIN' || role === 'admin';
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  // When impersonating, check the real admin's role (not the impersonated user's)
  const realAdmin = (req as any).realAdmin;
  if (realAdmin) {
    if (isAdmin(realAdmin.role)) {
      return next();
    }
    return res.status(403).json({ error: 'Admin access required' });
  }

  // Support both DB-backed user role and legacy session-based admin auth
  if (req.user && isAdmin((req.user as any).role)) {
    return next();
  }
  if (req.session.isAdmin) {
    return next();
  }
  if (!req.user && !req.session.isAdmin) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  res.status(403).json({ error: 'Admin access required' });
}
