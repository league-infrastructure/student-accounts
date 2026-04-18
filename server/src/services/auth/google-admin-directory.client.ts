/**
 * Google Admin Directory client abstraction (T004).
 *
 * Exports:
 *  - AdminDirectoryClient         — interface for OU lookups
 *  - GoogleAdminDirectoryClient   — real implementation using googleapis
 *  - FakeAdminDirectoryClient     — test double, no network calls
 *  - StaffOULookupError           — typed error thrown on any lookup failure
 *
 * Design decisions:
 *  - RD-001 (fail-secure): when service account credentials are absent or
 *    misconfigured, getUserOU() throws StaffOULookupError immediately. The
 *    app still starts cleanly because credentials are read only when
 *    getUserOU() is called, not at module load time.
 *  - The interface is injected into SignInHandler (T005) so tests can swap in
 *    FakeAdminDirectoryClient without network calls.
 *  - All googleapis imports are contained within this module.
 *
 * Scope required: https://www.googleapis.com/auth/admin.directory.user.readonly
 * The impersonated admin account must have Admin SDK read access in Google
 * Workspace.
 */

import pino from 'pino';
import { google } from 'googleapis';

const logger = pino({ name: 'google-admin-directory' });

// ---------------------------------------------------------------------------
// StaffOULookupError
// ---------------------------------------------------------------------------

/**
 * Thrown by any AdminDirectoryClient implementation when a user OU lookup
 * fails for any reason: missing credentials, network error, API error, or
 * user not found in the directory.
 *
 * Callers must treat this error as an access-denied signal for
 * @jointheleague.org accounts (per RD-001).
 */
export class StaffOULookupError extends Error {
  /** Machine-readable reason code for structured logging and telemetry. */
  readonly code: string;
  /** The email address that was being looked up, if available. */
  readonly email?: string;

  constructor(message: string, code: string, email?: string, cause?: unknown) {
    super(message);
    this.name = 'StaffOULookupError';
    this.code = code;
    this.email = email;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// AdminDirectoryClient interface
// ---------------------------------------------------------------------------

/**
 * Abstraction over Google Admin Directory API OU lookups.
 *
 * Implementations:
 *  - GoogleAdminDirectoryClient — real, uses googleapis + service account
 *  - FakeAdminDirectoryClient   — test double, returns a configured OU path
 */
export interface AdminDirectoryClient {
  /**
   * Return the Google Workspace orgUnitPath for the given email address.
   *
   * @param email - The user's primary email address.
   * @returns     - The orgUnitPath string (e.g. "/League Staff").
   * @throws StaffOULookupError on any failure (network, auth, user not found,
   *         missing credentials).
   */
  getUserOU(email: string): Promise<string>;
}

// ---------------------------------------------------------------------------
// GoogleAdminDirectoryClient — real implementation
// ---------------------------------------------------------------------------

const ADMIN_SDK_SCOPE =
  'https://www.googleapis.com/auth/admin.directory.user.readonly';

/**
 * Real implementation of AdminDirectoryClient using the Google Admin SDK.
 *
 * Authentication uses a Google service account with domain-wide delegation.
 * The service account must have the Admin SDK read scope granted in Google
 * Workspace.
 *
 * Usage in production (wired in passport.config.ts):
 *
 *   const client = new GoogleAdminDirectoryClient(
 *     process.env.GOOGLE_SERVICE_ACCOUNT_JSON!,
 *     process.env.GOOGLE_ADMIN_DELEGATED_USER_EMAIL!,
 *   );
 *
 * Missing or malformed credentials do NOT prevent app startup. The error is
 * deferred to the first getUserOU() call, where it is thrown as
 * StaffOULookupError and logged at ERROR level.
 */
export class GoogleAdminDirectoryClient implements AdminDirectoryClient {
  private readonly serviceAccountJson: string;
  private readonly delegatedUser: string;

  constructor(serviceAccountJson: string, delegatedUser: string) {
    this.serviceAccountJson = serviceAccountJson;
    this.delegatedUser = delegatedUser;
  }

  async getUserOU(email: string): Promise<string> {
    // --- Credential validation (fail-secure per RD-001) ---
    if (!this.serviceAccountJson || !this.delegatedUser) {
      const msg =
        '[google-admin-directory] GOOGLE_SERVICE_ACCOUNT_JSON or ' +
        'GOOGLE_ADMIN_DELEGATED_USER_EMAIL is missing. ' +
        `Cannot look up OU for ${email}. @jointheleague.org sign-in denied (RD-001).`;
      logger.error({ email }, msg);
      throw new StaffOULookupError(
        'Admin Directory credentials are not configured',
        'MISSING_CREDENTIALS',
        email,
      );
    }

    // --- Parse service account JSON ---
    let serviceAccountKey: Record<string, unknown>;
    try {
      serviceAccountKey = JSON.parse(this.serviceAccountJson) as Record<string, unknown>;
    } catch (parseErr) {
      const msg =
        '[google-admin-directory] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. ' +
        `Cannot look up OU for ${email}. @jointheleague.org sign-in denied (RD-001).`;
      logger.error({ email, err: parseErr }, msg);
      throw new StaffOULookupError(
        'Admin Directory service account JSON is malformed',
        'MALFORMED_CREDENTIALS',
        email,
        parseErr,
      );
    }

    // --- Build the Admin SDK client with domain-wide delegation ---
    let auth: InstanceType<typeof google.auth.JWT>;
    try {
      auth = new google.auth.JWT({
        email: serviceAccountKey['client_email'] as string,
        key: serviceAccountKey['private_key'] as string,
        scopes: [ADMIN_SDK_SCOPE],
        subject: this.delegatedUser,
      });
    } catch (authErr) {
      const msg =
        '[google-admin-directory] Failed to construct JWT auth client. ' +
        `Cannot look up OU for ${email}.`;
      logger.error({ email, err: authErr }, msg);
      throw new StaffOULookupError(
        'Failed to initialise Admin Directory auth client',
        'AUTH_INIT_FAILED',
        email,
        authErr,
      );
    }

    // --- Call the Admin SDK users.get endpoint ---
    try {
      const adminSdk = google.admin({ version: 'directory_v1', auth });
      const response = await adminSdk.users.get({
        userKey: email,
        projection: 'basic',
      });

      const orgUnitPath = response.data.orgUnitPath;
      if (!orgUnitPath) {
        const msg =
          `[google-admin-directory] users.get for ${email} returned no orgUnitPath.`;
        logger.error({ email }, msg);
        throw new StaffOULookupError(
          `No orgUnitPath returned for ${email}`,
          'MISSING_OU_PATH',
          email,
        );
      }

      return orgUnitPath;
    } catch (err) {
      // Re-throw StaffOULookupError unchanged (already logged above).
      if (err instanceof StaffOULookupError) {
        throw err;
      }

      const msg =
        `[google-admin-directory] Admin SDK users.get failed for ${email}.`;
      logger.error({ email, err }, msg);
      throw new StaffOULookupError(
        `Admin Directory lookup failed for ${email}`,
        'API_ERROR',
        email,
        err,
      );
    }
  }
}

// ---------------------------------------------------------------------------
// FakeAdminDirectoryClient — test double
// ---------------------------------------------------------------------------

/**
 * Test double for AdminDirectoryClient.
 *
 * Configured with a fixed OU path string (or an error to throw) at
 * construction time. No network calls are made.
 *
 * Usage in tests:
 *
 *   // Always returns a specific OU path
 *   const client = new FakeAdminDirectoryClient('/League Staff');
 *
 *   // Always throws StaffOULookupError
 *   const failing = new FakeAdminDirectoryClient(
 *     new StaffOULookupError('credentials missing', 'MISSING_CREDENTIALS'),
 *   );
 */
export class FakeAdminDirectoryClient implements AdminDirectoryClient {
  private readonly result: string | StaffOULookupError;

  /**
   * @param result - Either the OU path to return, or a StaffOULookupError
   *                 to throw when getUserOU() is called.
   */
  constructor(result: string | StaffOULookupError) {
    this.result = result;
  }

  async getUserOU(_email: string): Promise<string> {
    if (this.result instanceof StaffOULookupError) {
      throw this.result;
    }
    return this.result;
  }
}
