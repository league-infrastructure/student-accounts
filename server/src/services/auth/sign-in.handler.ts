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

import pino from 'pino';
import type { User } from '../../generated/prisma/client.js';
import type { UserService } from '../user.service.js';
import type { LoginService } from '../login.service.js';
import { AuditService } from '../audit.service.js';
import { mergeScan } from './merge-scan.stub.js';
import {
  type GoogleWorkspaceAdminClient,
  StaffOULookupError,
} from '../google-workspace/google-workspace-admin.client.js';

const logger = pino({ name: 'sign-in.handler' });

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
  provider: 'google' | 'github',
  profile: OAuthProfile,
  userService: UserService,
  loginService: LoginService,
  options?: SignInOptions,
): Promise<User> {
  const { providerUserId, providerEmail, displayName, providerUsername } = profile;

  // --- Step 1: Look up existing Login ---
  const existingLogin = await loginService.findByProvider(provider, providerUserId);

  let user: User;

  if (existingLogin) {
    // --- Step 2: Existing identity — load the User ---
    user = await userService.findById(existingLogin.user_id);
  } else {
    // --- Step 3: New identity — create User and Login atomically ---

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

    // 3a. Create User with audit event
    user = await userService.createWithAudit(
      {
        display_name: displayName || providerEmail || providerUserId,
        primary_email: resolvedEmail,
        role: 'student',
        created_via: 'social_login',
      },
      null, // system action; no acting user
    );

    // 3b. Create Login with audit event (pass provider_username for GitHub)
    await loginService.create(
      user.id,
      provider,
      providerUserId,
      providerEmail ?? null,
      null, // system action
      providerUsername ?? null,
    );

    // 3c. Merge-scan stub (Sprint 007 replaces this module)
    await mergeScan(user);
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
    const adminDirClient = options?.adminDirClient;
    const staffOuPath = process.env.GOOGLE_STAFF_OU_PATH ?? '/League Staff';

    if (!adminDirClient) {
      // No client injected — this is a coding error (passport.config.ts always
      // injects one). Log at ERROR and deny the sign-in as a fail-secure measure.
      logger.error(
        { email: providerEmail },
        '[sign-in.handler] No adminDirClient provided for @jointheleague.org sign-in. ' +
          'Denying access (fail-secure). Check passport.config.ts wiring.',
      );
      await _writeAuthDeniedEvent(options, providerEmail, 'NO_ADMIN_CLIENT');
      throw new StaffOULookupError(
        'No GoogleWorkspaceAdminClient available for @jointheleague.org sign-in',
        'NO_ADMIN_CLIENT',
        providerEmail,
      );
    }

    let ouPath: string;
    try {
      ouPath = await adminDirClient.getUserOU(providerEmail);
    } catch (err) {
      if (err instanceof StaffOULookupError) {
        // RD-001: fail-secure. Log, audit, and propagate.
        logger.error(
          { email: providerEmail, code: err.code, err },
          '[sign-in.handler] StaffOULookupError during @jointheleague.org sign-in — ' +
            'access denied (RD-001).',
        );
        await _writeAuthDeniedEvent(options, providerEmail, err.code);

        // The user/login records created in step 3 remain in the database.
        // No session is established, so the user cannot access the application.
        // On the next sign-in attempt, the existing Login row will be found
        // and the OU check will run again.

        throw err;
      }
      throw err;
    }

    // Determine role from OU path.
    // We always apply the OU result explicitly so that a returning user whose
    // admin status was revoked (email removed from ADMIN_EMAILS) has their role
    // reset to the OU-based value here, before the admin check below.
    if (ouPath.startsWith(staffOuPath)) {
      // Staff OU matched → promote/keep staff
      user = await userService.updateRole(user.id, 'staff');
    } else if (user.role !== 'student') {
      // OU does not match → ensure role is student (RD-003).
      // This also demotes any user who was previously admin/staff but whose OU
      // no longer qualifies, so that the admin check in step 5 starts from the
      // correct OU-derived baseline.
      user = await userService.updateRole(user.id, 'student');
    }
    // else: role is already 'student', no write needed

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
    const emailLower = providerEmail.toLowerCase();
    if (_adminEmails.has(emailLower)) {
      if (user.role !== 'admin') {
        const previousRole = user.role;
        user = await userService.updateRole(user.id, 'admin');
        // Emit role_changed audit event (best-effort)
        await _writeRoleChangedEvent(options, user.id, previousRole, 'admin');
      }
    }
  }

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

