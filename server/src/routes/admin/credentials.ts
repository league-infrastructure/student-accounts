/**
 * Admin credential routes (sprint 002 "laptop accounts" T005, SUC-003).
 *
 * The controls an instructor needs at the start of a class: set a student's
 * username, set or generate a password, and email both to an address of the
 * admin's choosing.
 *
 * GET  /users/:id/credentials        — current state for the Credentials card
 *                                      (username, whether a password is set,
 *                                      laptop flag/eligibility, the addresses
 *                                      the email dialog prefills from). Never
 *                                      returns a password or a hash.
 * PUT  /users/:id/credentials        — body { username?, password?,
 *                                      generatePassword? } → { username,
 *                                      password? } with the plaintext only
 *                                      when set or generated in this call.
 *                                      400 on a bad username or password,
 *                                      404 unknown user, 409 username taken.
 * POST /users/:id/credentials/email  — body { to, password?, note? } sends
 *                                      "Your League account". `to` must be an
 *                                      email address and not under `.invalid`
 *                                      (400). The password goes out only when
 *                                      supplied in this request: it is never
 *                                      readable later. → { sent: true } or
 *                                      { sent: false, skipped: true, reason }.
 *
 * Audit: admin_set_username / admin_set_password (UserService) and
 * credentials_emailed with the recipient; the password is never recorded.
 *
 * Auth (requireAuth + requireRole('admin')) is applied by the parent
 * adminRouter in routes/admin/index.ts.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { prisma } from '../../services/prisma.js';
import { UserRepository } from '../../services/repositories/user.repository.js';
import { buildCredentialsEmail, isUndeliverableAddress } from '../../services/mail.service.js';
import { NotFoundError, ValidationError } from '../../errors.js';

export const adminCredentialsRouter = Router();

/** Loose "looks like an address" check: something@something.tld, no spaces. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function parseUserId(raw: string | string[]): number | null {
  const id = parseInt(Array.isArray(raw) ? raw[0] : raw, 10);
  return Number.isFinite(id) && id > 0 ? id : null;
}

/** The public origin of this request, honouring the reverse proxy headers. */
function requestOrigin(req: Request): string {
  const forwardedProto = req.header('x-forwarded-proto');
  const scheme = forwardedProto
    ? forwardedProto.split(',')[0].trim()
    : (req as any).secure
      ? 'https'
      : 'http';
  const host = req.header('x-forwarded-host') ?? req.get('host') ?? 'localhost';
  return `${scheme}://${host}`;
}

// ---------------------------------------------------------------------------
// GET /users/:id/credentials
// ---------------------------------------------------------------------------

adminCredentialsRouter.get(
  '/users/:id/credentials',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = parseUserId(req.params.id);
      if (userId === null) {
        res.status(400).json({ error: 'Invalid user id' });
        return;
      }
      const user = await UserRepository.findByIdIncludingInactive(prisma, userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const u = user as any;
      res.json({
        username: u.username ?? null,
        hasPassword: !!u.password_hash,
        laptopLogin: req.services.laptopAccounts.isEligible(u),
        displayName: u.display_name,
        primaryEmail: u.primary_email,
        notificationEmail: u.notification_email ?? null,
      });
    } catch (err) {
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// PUT /users/:id/credentials
// ---------------------------------------------------------------------------

adminCredentialsRouter.put(
  '/users/:id/credentials',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = parseUserId(req.params.id);
      if (userId === null) {
        res.status(400).json({ error: 'Invalid user id' });
        return;
      }
      const body = (req.body ?? {}) as {
        username?: unknown;
        password?: unknown;
        generatePassword?: unknown;
      };
      if (body.username !== undefined && typeof body.username !== 'string') {
        res.status(400).json({ error: 'username must be a string' });
        return;
      }
      if (body.password !== undefined && typeof body.password !== 'string') {
        res.status(400).json({ error: 'password must be a string' });
        return;
      }
      if (body.generatePassword !== undefined && typeof body.generatePassword !== 'boolean') {
        res.status(400).json({ error: 'generatePassword must be a boolean' });
        return;
      }

      const actorId = (req.session as any).userId as number;
      const result = await req.services.users.setCredentialsByAdmin(
        userId,
        {
          ...(body.username !== undefined ? { username: body.username } : {}),
          ...(body.password !== undefined ? { password: body.password } : {}),
          ...(body.generatePassword !== undefined ? { generatePassword: body.generatePassword } : {}),
        },
        actorId,
      );
      res.json(result);
    } catch (err) {
      // The admin UI shows the rule message inline; 400 is what it expects.
      if (err instanceof ValidationError) {
        res.status(400).json({ error: err.message });
        return;
      }
      if (err instanceof NotFoundError) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// POST /users/:id/credentials/email
// ---------------------------------------------------------------------------

adminCredentialsRouter.post(
  '/users/:id/credentials/email',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const userId = parseUserId(req.params.id);
      if (userId === null) {
        res.status(400).json({ error: 'Invalid user id' });
        return;
      }
      const body = (req.body ?? {}) as { to?: unknown; password?: unknown; note?: unknown };

      const to = typeof body.to === 'string' ? body.to.trim() : '';
      if (!EMAIL_RE.test(to)) {
        res.status(400).json({ error: 'to must be an email address' });
        return;
      }
      if (isUndeliverableAddress(to)) {
        res.status(400).json({ error: 'Cannot send to an address under .invalid' });
        return;
      }
      if (body.password !== undefined && typeof body.password !== 'string') {
        res.status(400).json({ error: 'password must be a string' });
        return;
      }
      if (body.note !== undefined && typeof body.note !== 'string') {
        res.status(400).json({ error: 'note must be a string' });
        return;
      }
      const password = typeof body.password === 'string' && body.password !== '' ? body.password : undefined;
      const note = typeof body.note === 'string' ? body.note : undefined;

      const user = await UserRepository.findByIdIncludingInactive(prisma, userId);
      if (!user) {
        res.status(404).json({ error: 'User not found' });
        return;
      }
      const u = user as any;

      const { mail, laptopAccounts, audit } = req.services;
      if (!mail.isConfigured()) {
        res.status(400).json({
          error: 'SMTP not configured. Set SMTP_HOST, SMTP_PORT, SMTP_USERNAME, SMTP_PASSWORD in .env.',
        });
        return;
      }

      const content = buildCredentialsEmail({
        displayName: u.display_name,
        username: u.username ?? null,
        email: u.primary_email,
        password,
        siteUrl: requestOrigin(req),
        laptopLogin: laptopAccounts.isEligible(u),
        note,
      });

      const sent = await mail.send({ to, ...content });
      if (sent.skipped) {
        res.json({ sent: false, skipped: true, reason: sent.reason });
        return;
      }

      const actorId = (req.session as any).userId as number;
      await prisma.$transaction(async (tx: any) => {
        await audit.record(tx, {
          actor_user_id: actorId,
          action: 'credentials_emailed',
          target_user_id: userId,
          target_entity_type: 'User',
          target_entity_id: String(userId),
          details: { to, included_password: password !== undefined, included_note: !!note?.trim() },
        });
      });

      res.json({ sent: true });
    } catch (err) {
      next(err);
    }
  },
);
