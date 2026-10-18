/**
 * handlePassphraseSignup — handler for POST /api/auth/passphrase-signup.
 *
 * Public endpoint (no auth required). Students self-register using a
 * time-limited passphrase tied to a Group or Cohort scope.
 *
 * Algorithm:
 *  1. Validate inputs: username (laptop roster rules, sprint 002 T004),
 *     passphrase, password, displayName, email.
 *  2. Look up the passphrase via PassphraseService.findBySignupValue.
 *  3. Check username uniqueness here and on the laptop roster.
 *  4. Validate email uniqueness.
 *  5. Hash the password (not the passphrase): scrypt for this app plus the
 *     SHA-512 crypt form for the laptop roster.
 *  6. Create User + Login in a single transaction.
 *     - User: username, password_hash, laptop_password_hash,
 *       display_name=displayName, primary_email=email, onboarding_completed=true.
 *     - Login: provider='username', provider_email=email, provider_username=username.
 *  7. Set session.
 *  8. Fail-soft side effects: laptop roster write-back, workspace
 *     provisioning, LLM proxy grant, group membership.
 *  9. Notify adminBus.
 * 10. Return 200 with user details.
 */

import type { Request, Response } from 'express';
import { prisma } from '../prisma.js';
import { classifyEmailOwnership } from './email-ownership.js';
import { hashPassword, makeCryptHash } from '../../utils/password.js';
import { adminBus } from '../change-bus.js';
import { AuditService } from '../audit.service.js';
import { isValidRosterId } from '../laptop/roster-ids.js';
import {
  LAPTOP_USERNAME_RULES_MESSAGE,
  LAPTOP_USERNAME_TAKEN_MESSAGE,
} from '../laptop/laptop-account.service.js';

const auditService = new AuditService();

// ---------------------------------------------------------------------------
// Username validation helpers
// ---------------------------------------------------------------------------

/**
 * The username is the laptop login, so it must work as a laptop roster id: 3–32 chars of
 * `[a-z0-9-]`, starting with a letter or digit, not a reserved system name.
 * Case is not folded: Unix logins are case-sensitive.
 */
function validateUsername(raw: unknown): { valid: true; username: string } | { valid: false; error: string } {
  const username = typeof raw === 'string' ? raw.trim() : '';
  if (!isValidRosterId(username)) {
    return { valid: false, error: LAPTOP_USERNAME_RULES_MESSAGE };
  }
  return { valid: true, username };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

export async function handlePassphraseSignup(req: Request, res: Response): Promise<void> {
  const { username: rawUsername, passphrase, password, displayName, email } = req.body ?? {};

  // ------------------------------------------------------------------
  // 1. Validate inputs presence
  // ------------------------------------------------------------------
  if (!rawUsername || !passphrase) {
    res.status(400).json({ error: 'Username and passphrase are required' });
    return;
  }
  if (!password || typeof password !== 'string' || !password.trim()) {
    res.status(400).json({ error: 'Password is required' });
    return;
  }
  if (!displayName || typeof displayName !== 'string' || !displayName.trim()) {
    res.status(400).json({ error: 'Display name is required' });
    return;
  }
  if (!email || typeof email !== 'string' || !email.trim()) {
    res.status(400).json({ error: 'Email is required' });
    return;
  }

  const normalizedDisplayName = displayName.trim();
  const normalizedEmail = email.trim().toLowerCase();

  // ------------------------------------------------------------------
  // 1b. Validate username shape
  // ------------------------------------------------------------------
  const usernameResult = validateUsername(rawUsername);
  if (!usernameResult.valid) {
    res.status(400).json({ error: usernameResult.error });
    return;
  }
  const username = usernameResult.username;

  // ------------------------------------------------------------------
  // 2. Look up the passphrase
  // ------------------------------------------------------------------
  const passphraseMatch = await (req as any).services.passphrases.findBySignupValue(passphrase);
  if (!passphraseMatch) {
    res.status(401).json({ error: 'Invalid or expired passphrase' });
    return;
  }

  const { scope, id: scopeId, grantLlmProxy } = passphraseMatch;

  // ------------------------------------------------------------------
  // 3. Username collision check
  // ------------------------------------------------------------------
  const existingByUsername = await prisma.user.findUnique({ where: { username } });
  if (existingByUsername) {
    res.status(409).json({ error: 'That username is already taken' });
    return;
  }
  // A laptop account that was never imported must not be taken over here.
  const laptopAccounts = (req as any).services?.laptopAccounts;
  if (laptopAccounts && (await laptopAccounts.rosterIdTakenByOther(username, null))) {
    res.status(409).json({ error: LAPTOP_USERNAME_TAKEN_MESSAGE });
    return;
  }

  // ------------------------------------------------------------------
  // 4. Check email uniqueness across all users / logins / external accts.
  //    Signup has no current user yet, so any presence is 'other'.
  // ------------------------------------------------------------------
  const ownership = await classifyEmailOwnership(normalizedEmail, null);
  if (ownership !== 'free') {
    res.status(409).json({ error: 'That email address is already in use' });
    return;
  }

  // ------------------------------------------------------------------
  // 5. Hash the password (not the passphrase): scrypt for this app and
  //    SHA-512 crypt for the laptop roster (only possible with the plaintext).
  // ------------------------------------------------------------------
  const hashedPassword = await hashPassword(password);
  const laptopPasswordHash = makeCryptHash(password);

  // ------------------------------------------------------------------
  // 6. Create User + Login in a single transaction
  // ------------------------------------------------------------------
  let newUser: any;
  try {
    newUser = await prisma.$transaction(async (tx: any) => {
      const user = await tx.user.create({
        data: {
          username,
          password_hash: hashedPassword,
          laptop_password_hash: laptopPasswordHash,
          display_name: normalizedDisplayName,
          primary_email: normalizedEmail,
          role: 'student',
          approval_status: 'approved',
          is_active: true,
          onboarding_completed: true,
          cohort_id: scope === 'cohort' ? scopeId : null,
          created_via: 'passphrase_signup',
        },
      });

      await tx.login.create({
        data: {
          user_id: user.id,
          provider: 'username',
          provider_user_id: `${scope}:${scopeId}:${username}`,
          provider_email: normalizedEmail,
          provider_username: username,
        },
      });

      await auditService.record(tx, {
        actor_user_id: null,
        action: 'create_user',
        target_user_id: user.id,
        target_entity_type: 'User',
        target_entity_id: String(user.id),
        details: { created_via: 'passphrase_signup', scope, scopeId },
      });

      return user;
    });
  } catch (err: any) {
    // Handle unique constraint violation on username or email that slipped through
    res.status(500).json({ error: 'Failed to create account' });
    return;
  }

  // ------------------------------------------------------------------
  // 7. Set session (Passport + manual session fields)
  // ------------------------------------------------------------------
  await new Promise<void>((resolve, reject) =>
    req.login(newUser, (err) => (err ? reject(err) : resolve())),
  );
  (req.session as any).userId = newUser.id;
  (req.session as any).role = newUser.role;
  await new Promise<void>((resolve, reject) =>
    req.session.save((err) => (err ? reject(err) : resolve())),
  );

  // ------------------------------------------------------------------
  // 8. Fail-soft side effects
  // ------------------------------------------------------------------

  // Laptop roster write-back. reconcile() never throws; a failure marks the
  // user dirty for the hourly push job.
  if (laptopAccounts) {
    await laptopAccounts.reconcile(newUser.id, newUser.id);
  }

  // Workspace provisioning (cohort scope)
  let workspaceResult: { provisioned: boolean; error?: string } | undefined;
  if (scope === 'cohort') {
    try {
      await (req as any).services.workspaceProvisioning.provision(newUser.id, newUser.id);
      workspaceResult = { provisioned: true };
    } catch (err: any) {
      workspaceResult = { provisioned: false, error: err?.message ?? 'Workspace provisioning failed' };
    }
  }

  // LLM proxy token grant
  let llmProxyResult: { granted: boolean; error?: string } | undefined;
  if (grantLlmProxy) {
    try {
      await (req as any).services.llmProxyTokens.grant(
        newUser.id,
        { expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), tokenLimit: 1_000_000 },
        newUser.id,
        { scope: 'single' },
      );
      llmProxyResult = { granted: true };
    } catch (err: any) {
      llmProxyResult = { granted: false, error: err?.message ?? 'LLM proxy grant failed' };
    }
  }

  // Group membership (group scope)
  if (scope === 'group') {
    try {
      await (req as any).services.groups.addMember(scopeId, newUser.id, newUser.id);
    } catch (_err) {
      // Fail-soft: swallow error — user is created, membership is best-effort
    }
  }

  // ------------------------------------------------------------------
  // 9. Notify adminBus
  // ------------------------------------------------------------------
  adminBus.notify('users');
  if (scope === 'cohort') {
    adminBus.notify('cohorts');
  } else {
    adminBus.notify('groups');
  }

  // ------------------------------------------------------------------
  // 10. Response
  // ------------------------------------------------------------------
  res.status(200).json({
    id: newUser.id,
    username: newUser.username,
    displayName: newUser.display_name,
    primaryEmail: newUser.primary_email,
    cohort: scope === 'cohort' ? { id: scopeId } : null,
    workspace: workspaceResult,
    llmProxy: llmProxyResult,
  });
}
