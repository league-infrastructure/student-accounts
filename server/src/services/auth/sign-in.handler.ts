/**
 * SignInHandler — shared verify callback logic for all OAuth strategies.
 *
 * This module is a pure service function: it accepts typed inputs and returns a
 * typed User. No Express types appear in its signature so it can be tested
 * independently of the request/response cycle.
 *
 * Responsibilities:
 *  1. Look up an existing Login by (provider, providerUserId).
 *  2. If found, return the associated User (no creation).
 *  3. If not found:
 *     a. Create a User (role=student, created_via=social_login) via
 *        UserService.createWithAudit — audit event written atomically.
 *     b. Create a Login via LoginService.create — audit event written
 *        atomically.
 *     c. Call scanNewUser (merge-scan stub).
 *  4. Staff OU detection (T005): if provider=google AND email domain is
 *     @jointheleague.org, calls adminDirClient.getUserOU(email) to determine
 *     role. Staff OU prefix match → role=staff. No match → role=student (RD-003).
 *     StaffOULookupError → access denied; auth_denied audit event + ERROR log.
 *
 * See Sprint 002 architecture update for full flow description.
 */

import { createLogger } from '../logger.js';
import type { User } from '../../generated/prisma/client.js';
import { prisma } from '../prisma.js';
import type { UserService } from '../user.service.js';
import type { LoginService } from '../login.service.js';
import { AuditService } from '../audit.service.js';
import { adminBus } from '../change-bus.js';
import { mergeScan } from './merge-scan.stub.js';
import {
  type GoogleWorkspaceAdminClient,
  StaffOULookupError,
} from '../google-workspace/google-workspace-admin.client.js';

const logger = createLogger('sign-in.handler');

// ---------------------------------------------------------------------------
// League-specific defaults
// ---------------------------------------------------------------------------

/**
 * Default OU path prefix that identifies staff accounts.
 * Used when GOOGLE_STAFF_OU_PATH is not set in the environment.
 */
export const DEFAULT_STAFF_OU_PATH = '/League Staff';

/**
 * Default domain that identifies League staff accounts for OU lookup.
 * Used when GOOGLE_STAFF_OU_PATH is not set in the environment.
 */
export const DEFAULT_STAFF_DOMAIN = 'jointheleague.org';

// Track whether the GOOGLE_STAFF_OU_PATH default has been logged so we
// emit at most once per process.
let _staffOuPathDefaultLogged = false;

/**
 * Read GOOGLE_STAFF_OU_PATH from process.env, falling back to the League
 * default. Logs at INFO (once per process) when the default is in use.
 */
export function resolveStaffOuPath(): string | null {
  const value = process.env.GOOGLE_STAFF_OU_PATH;
  if (!value || value.trim() === '') {
    // Unset → skip OU lookup entirely. ADMIN_EMAILS still elevates to admin.
    return null;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Admin email set — parsed once at module load time (T006)
// ---------------------------------------------------------------------------

/**
 * Set of lowercase email addresses that should receive role=admin on
 * Google sign-in. Parsed from the ADMIN_EMAILS environment variable:
 * a comma-separated list, whitespace-trimmed, lowercased. Empty entries
 * are filtered out. An absent or empty ADMIN_EMAILS yields an empty set,
 * meaning no user gets role=admin via this path.
 *
 * The set is intentionally module-level so it is constructed once per
 * process (not per request), and can be replaced in tests via the
 * re-exported setter.
 */
let _adminEmails: Set<string> = _parseAdminEmails(process.env.ADMIN_EMAILS);

/** @internal Visible for testing only. */
export function _parseAdminEmails(raw: string | undefined): Set<string> {
  return new Set(
    (raw ?? '')
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean),
  );
}

/** @internal Replaces the module-level set; used in tests to inject values. */
export function _setAdminEmails(emails: Set<string>): void {
  _adminEmails = emails;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a sign-in attempt comes from an account that an admin has
 * permanently denied. Callers MUST NOT establish a session — the OAuth
 * callback should redirect the browser to a clear error page.
 *
 * Distinct from a regular `rejected` (re-tryable) state: a `rejected` user
 * who re-OAuths is reactivated as `pending` and re-enters the approval
 * queue. `rejected_permanent` is terminal.
 */
export class PermanentlyDeniedError extends Error {
  readonly userId: number;
  constructor(userId: number) {
    super('Account has been permanently denied');
    this.name = 'PermanentlyDeniedError';
    this.userId = userId;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface OAuthProfile {
  /** Provider-assigned unique identifier for this account. */
  providerUserId: string;
  /** Email address returned by the provider (may be null for GitHub). */
  providerEmail: string | null;
  /** Display name from the provider profile. */
  displayName: string;
  /** Provider-specific username (GitHub login, etc). Null for Google. */
  providerUsername?: string | null;
  /**
   * Raw provider profile object as returned by Passport (or for Pike13, the
   * profile returned by pike13FetchProfile). Stored as Login.provider_payload.
   * Optional — callers that do not pass it will leave provider_payload unchanged.
   */
  rawProfile?: unknown;
}

/**
 * Optional dependency-injected clients for the sign-in handler.
 *
 * - adminDirClient: Used for @jointheleague.org OU lookups (T005).
 * - auditService + prisma: Used to write auth_denied audit events when
 *   StaffOULookupError is thrown (RD-001).
 */
export interface SignInOptions {
  /** GoogleWorkspaceAdminClient for @jointheleague.org OU lookups. */
  adminDirClient?: GoogleWorkspaceAdminClient;
  /**
   * AuditService instance for writing auth_denied events on StaffOULookupError.
   * Required alongside `prisma` for the audit path to function.
   */
  auditService?: AuditService;
  /**
   * Prisma client used as the transaction context for audit event writes.
   * The AuditService.record() method accepts any PrismaClient-compatible
   * object as its transaction argument, including the top-level client.
   */
  prisma?: any;
  /**
   * HTTP request context for logging provenance. Both fields are optional
   * — sign-in still proceeds if they are absent or if the client is behind
   * a proxy that strips headers.
   */
  requestContext?: {
    ip?: string;
    userAgent?: string;
  };
}

// ---------------------------------------------------------------------------
// Handler
// ---------------------------------------------------------------------------

/**
 * Find or create a User and Login for an OAuth sign-in, then determine role.
 *
 * @param provider      - OAuth provider name ('google' | 'github').
 * @param profile       - Profile data from the OAuth provider.
 * @param userService   - UserService instance for User operations.
 * @param loginService  - LoginService instance for Login operations.
 * @param options       - Optional injection point for OU detection and audit.
 * @returns             - The User record (existing or newly created), with
 *                        role set to 'staff' if the @jointheleague.org OU
 *                        matches, or 'student' otherwise.
 * @throws StaffOULookupError if adminDirClient.getUserOU() fails for a
 *         @jointheleague.org account (RD-001 fail-secure). Callers must treat
 *         this as an access-denied signal and NOT establish a session.
 */
export async function signInHandler(
  provider: 'google' | 'github' | 'pike13',
  profile: OAuthProfile,
  userService: UserService,
  loginService: LoginService,
  options?: SignInOptions,
): Promise<User> {
  const { providerUserId, providerEmail, displayName, providerUsername, rawProfile } = profile;

  logger.info(
    { provider, providerUserId, providerEmail, displayName },
    '[sign-in.handler] signInHandler called'
  );

  // --- Step 1: Look up existing Login ---
  logger.info(
    { provider, providerUserId },
    '[sign-in.handler] Step 1: looking up existing login'
  );
  const existingLogin = await loginService.findByProvider(provider, providerUserId);
  logger.info(
    { provider, providerUserId, found: !!existingLogin },
    '[sign-in.handler] Step 1: login lookup result'
  );

  let user: User;
  // loginId is resolved from either the existing Login (step 1) or the newly-
  // created Login (step 3c). Used at the end to write provider_payload + LoginEvent.
  let loginId: number | null = existingLogin?.id ?? null;

  if (existingLogin) {
    // --- Step 2: Existing identity — load the User ---
    // Use findByIdIncludingInactive: a denied user is inactive, but we still
    // need to load them to decide between reactivation (rejected) and a hard
    // refusal (rejected_permanent). applyDeniedReentry handles both cases.
    logger.info(
      { existingLoginId: existingLogin.id, userId: existingLogin.user_id },
      '[sign-in.handler] Step 2: existing login found, loading user'
    );
    user = await userService.findByIdIncludingInactive(existingLogin.user_id);
    logger.info(
      { userId: user.id, email: user.primary_email, isActive: user.is_active },
      '[sign-in.handler] Step 2: user loaded'
    );
    user = await applyDeniedReentry(user);
  } else {
    // --- Step 3: New identity — attach Login to an existing User (matched
    // by primary email) or create a new User.

    logger.info(
      { provider, providerUserId, providerEmail },
      '[sign-in.handler] Step 3: new identity, resolving email'
    );

    // Resolve the primary email. For GitHub, if no public email is available,
    // fall back to <username>@github.invalid (RD-002). The .invalid TLD is
    // RFC-reserved and cannot be a real deliverable address.
    let resolvedEmail: string;
    if (providerEmail) {
      resolvedEmail = providerEmail;
    } else if (provider === 'github' && providerUsername) {
      console.warn(
        `[sign-in.handler] GitHub user "${providerUsername}" has no public email — ` +
          `using placeholder address ${providerUsername}@github.invalid (RD-002)`,
      );
      resolvedEmail = `${providerUsername}@github.invalid`;
    } else {
      resolvedEmail = `${providerUserId}@provider.invalid`;
    }

    logger.info(
      { resolvedEmail },
      '[sign-in.handler] Step 3a: resolved email, looking up existing user'
    );

    // 3a. Look for an existing User by primary email. If one exists (e.g.
    // created by admin seeding or a different provider on the same address),
    // attach the new Login to it rather than attempting to create a duplicate
    // User — the unique constraint on User.primary_email would otherwise
    // throw and the caller would see a silent oauth_denied.
    const existingUser = await userService.findByEmail(resolvedEmail);
    logger.info(
      { resolvedEmail, found: !!existingUser },
      '[sign-in.handler] Step 3a: user lookup result'
    );

    if (existingUser) {
      logger.info(
        { userId: existingUser.id, email: existingUser.primary_email },
        '[sign-in.handler] Step 3b: existing user found, attaching new login'
      );
      user = await applyDeniedReentry(existingUser);
    } else {
      // All Google/GitHub-created users start pending. Step 4 below
      // promotes them to 'approved' if the staff OU check passes;
      // anyone else stays pending and waits for an admin to approve
      // them in the dashboard's pending-accounts widget.
      logger.info(
        { resolvedEmail },
        '[sign-in.handler] Step 3b: new user, creating with audit (pending)'
      );
      user = await userService.createWithAudit(
        {
          display_name: displayName || providerEmail || providerUserId,
          primary_email: resolvedEmail,
          role: 'student',
          created_via: 'social_login',
          approval_status: 'pending',
          onboarding_completed: false,
        },
        null, // system action; no acting user
      );
      logger.info(
        { userId: user.id, email: user.primary_email, approvalStatus: user.approval_status },
        '[sign-in.handler] Step 3b: user created (pending)'
      );

      // Always notify the dashboard — every new sign-in starts in the
      // approval queue.
      adminBus.notify('pending-users');
      adminBus.notify('users');
    }

    // 3b. Create Login with audit event (pass provider_username for GitHub)
    logger.info(
      { userId: user.id, provider, providerUserId },
      '[sign-in.handler] Step 3c: creating login'
    );
    const newLogin = await loginService.create(
      user.id,
      provider,
      providerUserId,
      providerEmail ?? null,
      null, // system action
      providerUsername ?? null,
    );
    loginId = newLogin.id;
    logger.info(
      { userId: user.id, provider, providerUserId, loginId },
      '[sign-in.handler] Step 3c: login created'
    );

    // 3c. Merge-scan (Sprint 007) — only for freshly created users.
    // Fire-and-forget: must not block the sign-in path. Any errors are
    // logged inside mergeScan itself; failure here is non-fatal for auth.
    if (!existingUser) {
      const scanUser = user;
      logger.info(
        { userId: scanUser.id },
        '[sign-in.handler] Step 3d: queueing merge-scan'
      );
      setImmediate(() => {
        mergeScan(scanUser).catch((err) => {
          logger.error(
            { userId: scanUser.id, err },
            '[sign-in.handler] background mergeScan failed'
          );
        });
      });
    }
  }

  // --- Step 4: Staff OU detection (@jointheleague.org accounts only) ---
  //
  // Only runs for Google sign-ins with a @jointheleague.org email address.
  // @students.jointheleague.org, gmail.com, and all other domains are skipped
  // and receive role=student (unchanged from creation default).
  //
  // Behaviour:
  //   - OU path starts with GOOGLE_STAFF_OU_PATH → update role to 'staff'.
  //   - OU path does not start with GOOGLE_STAFF_OU_PATH → keep role 'student'
  //     (RD-003: @jointheleague.org accounts not yet in the staff OU sign in
  //     as students, not a hard deny).
  //   - getUserOU() throws StaffOULookupError → emit auth_denied audit event,
  //     log at ERROR, and re-throw so the caller denies sign-in (RD-001).

  if (provider === 'google' && providerEmail?.toLowerCase().endsWith('@jointheleague.org')) {
    logger.info(
      { email: providerEmail },
      '[sign-in.handler] Step 4: @jointheleague.org account, checking staff OU'
    );
    const adminDirClient = options?.adminDirClient;
    const staffOuPath = resolveStaffOuPath();

    logger.info(
      { staffOuPath: staffOuPath ?? 'UNSET', hasAdminClient: !!adminDirClient },
      '[sign-in.handler] Step 4: staff OU config'
    );

    // GOOGLE_STAFF_OU_PATH unset → skip the OU lookup entirely.
    // Role stays student (or gets elevated to admin below by ADMIN_EMAILS).
    if (staffOuPath === null) {
      logger.info(
        { email: providerEmail },
        '[sign-in.handler] Step 4: GOOGLE_STAFF_OU_PATH unset — skipping OU lookup.',
      );
    } else if (!adminDirClient) {
      // No client injected — this is a coding error (passport.config.ts always
      // injects one). Log at ERROR and deny the sign-in as a fail-secure measure.
      logger.error(
        { email: providerEmail },
        '[sign-in.handler] Step 4: No adminDirClient provided for @jointheleague.org sign-in. ' +
          'Denying access (fail-secure). Check passport.config.ts wiring.',
      );
      await _writeAuthDeniedEvent(options, providerEmail, 'NO_ADMIN_CLIENT');
      throw new StaffOULookupError(
        'No GoogleWorkspaceAdminClient available for @jointheleague.org sign-in',
        'NO_ADMIN_CLIENT',
        providerEmail,
      );
    }

    // Only call the Admin SDK if staffOuPath is set AND a client is injected.
    // Admin role is treated as manually granted (via the Users panel or
    // ADMIN_EMAILS) and is never overwritten by OU-based role resolution.
    if (staffOuPath !== null && adminDirClient && user.role !== 'admin') {
      logger.info(
        { email: providerEmail },
        '[sign-in.handler] Step 4: calling getUserOU'
      );
      let ouPath: string;
      try {
        ouPath = await adminDirClient.getUserOU(providerEmail);
        logger.info(
          { email: providerEmail, ouPath },
          '[sign-in.handler] Step 4: getUserOU succeeded'
        );
      } catch (err) {
        if (err instanceof StaffOULookupError) {
          logger.error(
            { email: providerEmail, code: err.code, err },
            '[sign-in.handler] Step 4: StaffOULookupError — access denied (RD-001).',
          );
          await _writeAuthDeniedEvent(options, providerEmail, err.code);
          throw err;
        }
        throw err;
      }

      if (ouPath.startsWith(staffOuPath)) {
        logger.info(
          { email: providerEmail, ouPath, staffOuPath, currentRole: user.role },
          '[sign-in.handler] Step 4: OU matches staff path'
        );
        // Staff in /Staff get auto-approved — their Workspace
        // membership is the proof. This is the only auto-approval
        // path during a Google sign-in; everyone else stays pending.
        // (admin role is short-circuited above; user.role is student|staff here.)
        const needsRoleUpdate = user.role !== 'staff';
        const needsApproval = user.approval_status !== 'approved';
        if (needsRoleUpdate || needsApproval) {
          user = (await prisma.user.update({
            where: { id: user.id },
            data: {
              ...(needsRoleUpdate ? { role: 'staff' } : {}),
              ...(needsApproval ? { approval_status: 'approved' } : {}),
              ...(user.onboarding_completed ? {} : { onboarding_completed: true }),
            },
          })) as any;
          logger.info(
            { userId: user.id, role: user.role, approvalStatus: user.approval_status },
            '[sign-in.handler] Step 4: staff promotion + approval'
          );
        }
      } else {
        logger.info(
          { email: providerEmail, ouPath, staffOuPath },
          '[sign-in.handler] Step 4: OU does not match staff path'
        );
        if (user.role === 'staff') {
          user = await userService.updateRole(user.id, 'student');
          logger.info(
            { userId: user.id, newRole: 'student' },
            '[sign-in.handler] Step 4: role downgraded to student'
          );
        }
      }
    }

    // --- Step 5: Admin email check (T006) ---
    //
    // After the staff OU determination, check whether the user's email is in
    // ADMIN_EMAILS. If so, elevate role to 'admin' regardless of OU membership.
    // This check runs only for @jointheleague.org accounts (already inside the
    // `provider === 'google' && endsWith('@jointheleague.org')` branch).
    //
    // The check is case-insensitive; _adminEmails stores lowercased values.
    //
    // On a returning user whose role was previously non-admin but whose email
    // is now in ADMIN_EMAILS, the role is promoted and a role_changed audit
    // event is emitted. If the email is REMOVED from ADMIN_EMAILS, the role
    // reverts to the OU-based value determined in step 4.
    logger.info(
      { email: providerEmail, adminEmailsSize: _adminEmails.size },
      '[sign-in.handler] Step 5: checking admin emails'
    );
    const emailLower = providerEmail.toLowerCase();
    if (_adminEmails.has(emailLower)) {
      logger.info(
        { email: providerEmail },
        '[sign-in.handler] Step 5: email in ADMIN_EMAILS'
      );
      const previousRole = user.role;
      const needsRoleUpdate = user.role !== 'admin';
      const needsApproval = user.approval_status !== 'approved';
      if (needsRoleUpdate || needsApproval) {
        user = (await prisma.user.update({
          where: { id: user.id },
          data: {
            ...(needsRoleUpdate ? { role: 'admin' } : {}),
            ...(needsApproval ? { approval_status: 'approved' } : {}),
            ...(user.onboarding_completed ? {} : { onboarding_completed: true }),
          },
        })) as any;
        logger.info(
          { userId: user.id, previousRole, newRole: user.role, approvalStatus: user.approval_status },
          '[sign-in.handler] Step 5: admin promotion + approval'
        );
        if (needsRoleUpdate) {
          await _writeRoleChangedEvent(options, user.id, previousRole, 'admin');
        }
      }
    } else {
      logger.info(
        { email: providerEmail },
        '[sign-in.handler] Step 5: email NOT in ADMIN_EMAILS'
      );
    }
  } else if (provider === 'google') {
    logger.info(
      { email: providerEmail },
      '[sign-in.handler] Step 4-5: non-@jointheleague.org Google account, skipping OU and admin checks'
    );
  } else {
    logger.info(
      { provider },
      '[sign-in.handler] Step 4-5: non-Google provider, skipping OU and admin checks'
    );
  }

  // --- Final step: Write provider_payload + LoginEvent (provenance) ---
  //
  // Best-effort: if rawProfile or loginId is absent, skip silently.
  // Failure to write provenance must never block the sign-in path.
  if (loginId !== null && rawProfile !== undefined) {
    try {
      const now = new Date();
      await prisma.login.update({
        where: { id: loginId },
        data: {
          provider_payload: rawProfile as any,
          provider_payload_updated_at: now,
        },
      });
      await prisma.loginEvent.create({
        data: {
          login_id: loginId,
          payload: rawProfile as any,
          ip: options?.requestContext?.ip ?? null,
          user_agent: options?.requestContext?.userAgent ?? null,
        },
      });
      logger.info(
        { loginId, userId: user.id },
        '[sign-in.handler] provenance written (provider_payload + LoginEvent)'
      );
    } catch (provenanceErr) {
      logger.error(
        { loginId, userId: user.id, err: provenanceErr },
        '[sign-in.handler] Failed to write provenance — sign-in still succeeds'
      );
    }
  }

  logger.info(
    { userId: user.id, email: user.primary_email, role: user.role },
    '[sign-in.handler] signInHandler completed successfully'
  );
  return user;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Write a role_changed AuditEvent when the admin email check promotes a user
 * to admin on sign-in. Best-effort: if audit write fails, log the error but
 * do not block the sign-in.
 */
async function _writeRoleChangedEvent(
  options: SignInOptions | undefined,
  userId: number,
  previousRole: string,
  newRole: string,
): Promise<void> {
  if (!options?.auditService || !options?.prisma) {
    return;
  }
  try {
    await options.auditService.record(options.prisma, {
      actor_user_id: null,
      action: 'role_changed',
      target_user_id: userId,
      target_entity_type: 'User',
      target_entity_id: String(userId),
      details: { previous_role: previousRole, new_role: newRole, reason: 'admin_emails_match' },
    });
  } catch (auditErr) {
    logger.error(
      { userId, err: auditErr },
      '[sign-in.handler] Failed to write role_changed audit event.',
    );
  }
}

/**
 * Handle the inactive-account re-entry case for an existing user found
 * during sign-in. Active users are returned unchanged.
 *
 *   is_active=false + approval_status === 'rejected_permanent'
 *     → throw PermanentlyDeniedError. Caller MUST NOT establish a session.
 *       Only an admin manually flipping the status can lift this.
 *
 *   is_active=false (any other status, e.g. 'rejected', 'pending', 'approved')
 *     → reactivate the user (is_active=true, approval_status='pending'),
 *       notify the admin queue, return the updated user. The user re-enters
 *       the approval queue and the OAuth callback's pending-gate redirects
 *       them to the "awaiting approval" message.
 *
 *       The catch-all (vs. requiring approval_status='rejected' specifically)
 *       handles two cases:
 *         - Legacy denied users created before the rejected/rejected_permanent
 *           split: they have is_active=false but approval_status='pending'.
 *         - Any future "deactivate user" path that doesn't set approval_status
 *           explicitly. Forcing the user back through the approval queue is
 *           the safe default.
 */
async function applyDeniedReentry(user: User): Promise<User> {
  if (user.is_active) return user;

  if (user.approval_status === 'rejected_permanent') {
    logger.warn(
      { userId: user.id, email: user.primary_email },
      '[sign-in.handler] PermanentlyDeniedError: account permanently denied'
    );
    throw new PermanentlyDeniedError(user.id);
  }

  logger.info(
    { userId: user.id, email: user.primary_email, previousStatus: user.approval_status },
    '[sign-in.handler] reactivating inactive user back into the approval queue'
  );
  const updated = (await prisma.user.update({
    where: { id: user.id },
    data: {
      is_active: true,
      approval_status: 'pending',
    },
  })) as User;
  adminBus.notify('pending-users');
  adminBus.notify('users');
  return updated;
}

/**
 * Write an auth_denied AuditEvent if auditService and prisma are available
 * in options. Best-effort: if audit write fails, log the error but do not
 * block the auth-denied response — the ERROR log itself is the primary
 * observability signal (RD-001).
 */
async function _writeAuthDeniedEvent(
  options: SignInOptions | undefined,
  email: string,
  code: string,
): Promise<void> {
  if (!options?.auditService || !options?.prisma) {
    return;
  }
  try {
    await options.auditService.record(options.prisma, {
      actor_user_id: null,
      action: 'auth_denied',
      target_entity_type: 'Login',
      target_entity_id: email,
      details: { reason: 'staff_ou_lookup_failed', code },
    });
  } catch (auditErr) {
    logger.error(
      { email, err: auditErr },
      '[sign-in.handler] Failed to write auth_denied audit event.',
    );
  }
}

