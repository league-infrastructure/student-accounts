/**
 * loginRouter — production POST /api/auth/login endpoint.
 *
 * Public endpoint (no auth required). Accepts username + password,
 * verifies against the stored scrypt hash, and establishes a session.
 *
 * All failure paths return the same generic 401 body so callers cannot
 * distinguish "no user", "wrong password", "inactive user", or
 * "missing fields" from each other. This prevents username enumeration.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../services/prisma.js';
import { verifyPassword } from '../../utils/password.js';
import { AuditService } from '../../services/audit.service.js';
import { createLogger } from '../../services/logger.js';

const logger = createLogger('auth.login');
const auditService = new AuditService();

const GENERIC_401 = { error: 'Invalid username or password' };

export const loginRouter = Router();

loginRouter.post('/login', async (req: Request, res: Response) => {
  const { username: rawUsername, password } = req.body ?? {};

  // ------------------------------------------------------------------
  // 1. Validate presence and type of inputs. Generic 401 — never leak
  //    which field is missing to prevent enumeration.
  // ------------------------------------------------------------------
  if (!rawUsername || typeof rawUsername !== 'string' || !password || typeof password !== 'string') {
    return res.status(401).json(GENERIC_401);
  }

  const username = rawUsername.trim().toLowerCase();

  // ------------------------------------------------------------------
  // 2. Look up user by username.
  // ------------------------------------------------------------------
  const user = await prisma.user.findUnique({ where: { username } });

  // ------------------------------------------------------------------
  // 3. Reject if user not found, no password hash (OAuth-only), or inactive.
  //    All three cases return the same generic 401 body.
  // ------------------------------------------------------------------
  if (user == null || user.password_hash == null || user.is_active === false) {
    return res.status(401).json(GENERIC_401);
  }

  // ------------------------------------------------------------------
  // 4. Verify the password. False → generic 401.
  // ------------------------------------------------------------------
  const valid = await verifyPassword(password, user.password_hash);
  if (!valid) {
    return res.status(401).json(GENERIC_401);
  }

  // ------------------------------------------------------------------
  // 5. Establish session — same approach as passphrase-signup handler:
  //    req.login (Passport serialise) + manual session fields + save.
  // ------------------------------------------------------------------
  await new Promise<void>((resolve, reject) =>
    req.login(user, (err) => (err ? reject(err) : resolve())),
  );
  (req.session as any).userId = user.id;
  (req.session as any).role = user.role;
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );

  // ------------------------------------------------------------------
  // 6. Audit — fire-and-forget; failures are logged but do not block
  //    the response.
  // ------------------------------------------------------------------
  auditService
    .record(prisma, {
      actor_user_id: user.id,
      action: 'sign_in',
      target_user_id: user.id,
      target_entity_type: 'User',
      target_entity_id: String(user.id),
      details: { method: 'password' },
    })
    .catch((err) => {
      logger.error({ err }, '[login] failed to write sign_in audit event');
    });

  // ------------------------------------------------------------------
  // 7. Respond with user shape.
  // ------------------------------------------------------------------
  return res.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    primaryEmail: user.primary_email,
    role: user.role,
  });
});
