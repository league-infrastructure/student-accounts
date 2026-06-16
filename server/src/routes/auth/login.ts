/**
 * loginRouter — production POST /api/auth/login endpoint.
 *
 * Public endpoint (no auth required). The identifier may be a username or a
 * primary email. Two credentials are accepted, tried in order:
 *   1. the user's real password (verified against the stored scrypt hash);
 *   2. an active signup passphrase of a group/cohort the user belongs to —
 *      so a student who forgot their password can sign in with the phrase
 *      their instructor posted. Only non-expired passphrases match, and the
 *      passphrase is scoped to its own group/cohort's members.
 *
 * All failure paths return the same generic 401 body so callers cannot
 * distinguish "no user", "wrong password", "inactive user", or
 * "missing fields" from each other. This prevents username enumeration.
 */

import { Router, type Request, type Response } from 'express';
import { prisma } from '../../services/prisma.js';
import { verifyPassword } from '../../utils/password.js';
import { AuditService } from '../../services/audit.service.js';
import { PassphraseService } from '../../services/passphrase.service.js';
import { createLogger } from '../../services/logger.js';

const logger = createLogger('auth.login');
const auditService = new AuditService();
const passphraseService = new PassphraseService(prisma, auditService);

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

  const identifier = rawUsername.trim();
  const identifierLower = identifier.toLowerCase();

  // ------------------------------------------------------------------
  // 2. Look up the user by username (stored lowercase) or primary email
  //    (matched as typed and lowercased to tolerate casing).
  // ------------------------------------------------------------------
  let user = await prisma.user.findUnique({ where: { username: identifierLower } });
  if (user == null) {
    user =
      (await prisma.user.findUnique({ where: { primary_email: identifier } })) ??
      (await prisma.user.findUnique({ where: { primary_email: identifierLower } }));
  }

  // ------------------------------------------------------------------
  // 3. Reject unknown or inactive users. A missing password hash is NOT
  //    rejected here — the passphrase path below can still authenticate.
  // ------------------------------------------------------------------
  if (user == null || user.is_active === false) {
    return res.status(401).json(GENERIC_401);
  }
  const u = user; // non-null, active

  // ------------------------------------------------------------------
  // 4. Authenticate. Accept the real password, else an active group/cohort
  //    passphrase the user belongs to. findBySignupValue only matches
  //    non-expired passphrases (expiry strictly enforced), and the
  //    membership check scopes a passphrase to its own group/cohort.
  // ------------------------------------------------------------------
  let method: 'password' | 'passphrase' | null = null;
  let passphraseScope: { scope: 'group' | 'cohort'; id: number } | null = null;

  if (u.password_hash != null && (await verifyPassword(password, u.password_hash))) {
    method = 'password';
  }

  if (method == null) {
    const match = await passphraseService.findBySignupValue(password.trim().toLowerCase());
    if (match && (await userBelongsToScope(u.id, u.cohort_id, match))) {
      method = 'passphrase';
      passphraseScope = { scope: match.scope, id: match.id };
    }
  }

  if (method == null) {
    return res.status(401).json(GENERIC_401);
  }

  // ------------------------------------------------------------------
  // 5. Establish session — req.login (Passport serialise) + manual
  //    session fields + save.
  // ------------------------------------------------------------------
  await new Promise<void>((resolve, reject) =>
    req.login(u, (err) => (err ? reject(err) : resolve())),
  );
  (req.session as any).userId = u.id;
  (req.session as any).role = u.role;
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );

  // ------------------------------------------------------------------
  // 6. Audit — fire-and-forget; failures are logged but do not block
  //    the response.
  // ------------------------------------------------------------------
  auditService
    .record(prisma, {
      actor_user_id: u.id,
      action: 'sign_in',
      target_user_id: u.id,
      target_entity_type: 'User',
      target_entity_id: String(u.id),
      details: {
        method,
        ...(passphraseScope
          ? { passphraseScope: passphraseScope.scope, passphraseScopeId: passphraseScope.id }
          : {}),
      },
    })
    .catch((err) => {
      logger.error({ err }, '[login] failed to write sign_in audit event');
    });

  // ------------------------------------------------------------------
  // 7. Respond with user shape.
  // ------------------------------------------------------------------
  return res.json({
    id: u.id,
    username: u.username,
    displayName: u.display_name,
    primaryEmail: u.primary_email,
    role: u.role,
  });
});

/**
 * Whether the user belongs to the group/cohort that owns a matched passphrase.
 * Scopes passphrase logins so a phrase only unlocks accounts in its own scope.
 */
async function userBelongsToScope(
  userId: number,
  cohortId: number | null,
  match: { scope: 'group' | 'cohort'; id: number },
): Promise<boolean> {
  if (match.scope === 'cohort') {
    return cohortId != null && cohortId === match.id;
  }
  const membership = await prisma.userGroup.findFirst({
    where: { user_id: userId, group_id: match.id },
  });
  return membership != null;
}
