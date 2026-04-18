import { Request, Response, NextFunction } from 'express';
import { prisma } from '../services/prisma';

declare module 'express-session' {
  interface SessionData {
    impersonatingUserId?: number;
    realAdminId?: number;
  }
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      realAdmin?: any;
    }
  }
}

/**
 * Post-passport middleware that swaps req.user when an admin is impersonating
 * another user. The real admin identity is preserved on req.realAdmin so that
 * requireAdmin can still grant access to admin routes.
 */
export async function impersonateMiddleware(req: Request, _res: Response, next: NextFunction) {
  if (!req.session.impersonatingUserId) return next();

  try {
    const impersonatedUser = await prisma.user.findUnique({
      where: { id: req.session.impersonatingUserId },
    });

    if (!impersonatedUser) {
      // Target user was deleted — clear impersonation and continue as real user
      delete req.session.impersonatingUserId;
      delete req.session.realAdminId;
      return next();
    }

    // Preserve real admin identity, swap req.user
    req.realAdmin = req.user;
    req.user = impersonatedUser;
    next();
  } catch (_err) {
    // On error, don't block the request — just skip impersonation
    next();
  }
}
