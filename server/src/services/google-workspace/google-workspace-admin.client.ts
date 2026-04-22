/**
 * Google Workspace Admin client abstraction (Sprint 004 T001).
 *
 * Renames and extends the Sprint 002 GoogleAdminDirectoryClient to include
 * write operations for user and OU management.
 *
 * Exports:
 *  - GoogleWorkspaceAdminClient  — interface covering read + write operations
 *  - GoogleWorkspaceAdminClientImpl — real implementation using googleapis
 *  - StaffOULookupError          — typed error thrown on getUserOU failure
 *  - WorkspaceApiError           — typed error thrown on Admin SDK HTTP errors
 *  - CreateUserParams            — input type for createUser
 *  - CreatedUser                 — return type for createUser
 *  - CreatedOU                   — return type for createOU
 *  - WorkspaceUser               — element type for listUsersInOU
 *  - resolveCredentialsFileEnvVar — helper that resolves the credentials file
 *    env var, reading GOOGLE_CRED_FILE.
 *
 * Design decisions:
 *  - Extends in place (Architecture Decision 1): credential loading, auth
 *    client construction, and the getUserOU method are preserved unchanged
 *    from Sprint 002. Write methods share the same credential resolution path.
 *  - Broader scopes: Sprint 002 used admin.directory.user.readonly only.
 *    Sprint 004 adds admin.directory.user (write) and admin.directory.orgunit.
 *    The auth client is constructed with all three scopes for all calls.
 *  - Write-enable flag and domain/OU guard are NOT in this file — those are
 *    implemented in T002. This ticket delivers the structural extension only.
 *  - GOOGLE_STUDENT_OU_ROOT is read from process.env inside createOU().
 *    The guard against an invalid/missing root is T002's responsibility.
 *  - Credential file env var: GOOGLE_CRED_FILE is the single canonical name
 *    for the service account credentials file path (Sprint 010 rename).
 *  - League-specific defaults (OOP fix): GOOGLE_STUDENT_DOMAIN defaults to
 *    "students.jointheleague.org", GOOGLE_STUDENT_OU_ROOT defaults to
 *    "/Students". Each default is logged at INFO once per process.
 *
 * Scopes required:
 *  https://www.googleapis.com/auth/admin.directory.user.readonly
 *  https://www.googleapis.com/auth/admin.directory.user
 *  https://www.googleapis.com/auth/admin.directory.orgunit
 *
 * The impersonated admin account must have domain-wide delegation granted
 * for all three scopes in the Google Admin console.
 */

import fs from 'fs';
import path from 'path';
import { createLogger } from '../logger.js';
import { google } from 'googleapis';

const logger = createLogger('google-workspace-admin');

// ---------------------------------------------------------------------------
// League-specific defaults (logged once per process)
// ---------------------------------------------------------------------------

/**
 * Default domain for student Google Workspace accounts.
 * Used when GOOGLE_STUDENT_DOMAIN is not set.
 */
export const DEFAULT_STUDENT_DOMAIN = 'students.jointheleague.org';

/**
 * Default OU root path under which all student cohort OUs are created.
 * Used when GOOGLE_STUDENT_OU_ROOT is not set.
 */
export const DEFAULT_STUDENT_OU_ROOT = '/Students';

// Track whether defaults have already been logged so we emit at most once
// per process per variable.
let _studentDomainDefaultLogged = false;
let _studentOuRootDefaultLogged = false;

/**
 * Read GOOGLE_STUDENT_DOMAIN from process.env, falling back to the League
 * default. Logs at INFO (once per process) when the default is in use.
 */
export function resolveStudentDomain(): string {
  const value = process.env.GOOGLE_STUDENT_DOMAIN;
  if (!value) {
    if (!_studentDomainDefaultLogged) {
      logger.info(
        { default: DEFAULT_STUDENT_DOMAIN },
        '[google-workspace-admin] GOOGLE_STUDENT_DOMAIN is not set — ' +
          `using default "${DEFAULT_STUDENT_DOMAIN}".`,
      );
      _studentDomainDefaultLogged = true;
    }
    return DEFAULT_STUDENT_DOMAIN;
  }
  return value;
}

/**
 * Read GOOGLE_STUDENT_OU_ROOT from process.env, falling back to the League
 * default. Logs at INFO (once per process) when the default is in use.
 */
export function resolveStudentOuRoot(): string {
  const value = process.env.GOOGLE_STUDENT_OU_ROOT;
  if (!value) {
    if (!_studentOuRootDefaultLogged) {
      logger.info(
        { default: DEFAULT_STUDENT_OU_ROOT },
        '[google-workspace-admin] GOOGLE_STUDENT_OU_ROOT is not set — ' +
          `using default "${DEFAULT_STUDENT_OU_ROOT}".`,
      );
      _studentOuRootDefaultLogged = true;
    }
    return DEFAULT_STUDENT_OU_ROOT;
  }
  return value;
}

// ---------------------------------------------------------------------------
// Credentials file env var alias
// ---------------------------------------------------------------------------

/**
 * Resolve the Google service account credentials file env var.
 *
 * Reads GOOGLE_CRED_FILE. Returns the value (possibly an empty string when
 * not set).
 */
export function resolveCredentialsFileEnvVar(): string {
  return process.env.GOOGLE_CRED_FILE ?? '';
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown by any GoogleWorkspaceAdminClient implementation when a user OU
 * lookup fails for any reason: missing credentials, network error, API error,
 * or user not found in the directory.
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

/**
 * Thrown when the Admin SDK returns an HTTP error response for a write
 * operation (createUser, createOU, suspendUser, deleteUser, listUsersInOU).
 */
export class WorkspaceApiError extends Error {
  readonly statusCode?: number;
  readonly method: string;

  constructor(message: string, method: string, statusCode?: number, cause?: unknown) {
    super(message);
    this.name = 'WorkspaceApiError';
    this.method = method;
    this.statusCode = statusCode;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when a write method is called but GOOGLE_WORKSPACE_WRITE_ENABLED is
 * not set to exactly "1". This is a safety gate that prevents accidental writes
 * in development or misconfigured environments.
 *
 * Read methods (getUserOU, listUsersInOU) are NOT affected by this gate.
 */
export class WorkspaceWriteDisabledError extends Error {
  constructor() {
    super(
      'Google Workspace write operations are disabled. ' +
        'Set GOOGLE_WORKSPACE_WRITE_ENABLED=1 to enable them.',
    );
    this.name = 'WorkspaceWriteDisabledError';
  }
}

/**
 * Thrown by createUser when the primaryEmail domain or orgUnitPath violates
 * the student domain/OU guardrails. This is a defence-in-depth check that fires
 * even if the caller has already validated the values.
 *
 * @param reason - Human-readable explanation of which guard triggered.
 */
export class WorkspaceDomainGuardError extends Error {
  readonly reason: string;

  constructor(reason: string) {
    super(`Google Workspace domain/OU guard triggered: ${reason}`);
    this.name = 'WorkspaceDomainGuardError';
    this.reason = reason;
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface CreateUserParams {
  /** Must be on GOOGLE_STUDENT_DOMAIN (guard enforced in T002). */
  primaryEmail: string;
  /** Must be under GOOGLE_STUDENT_OU_ROOT (guard enforced in T002). */
  orgUnitPath: string;
  givenName: string;
  familyName: string;
  sendNotificationEmail: boolean;
  /**
   * Recovery/secondary email used for Google's welcome-email flow. When
   * set, Google sends the welcome message (with the temp password, if
   * welcome email is enabled at the org level) here rather than to the
   * brand-new League inbox that the student can't yet log into.
   */
  recoveryEmail?: string | null;
}

export interface CreatedUser {
  /** Google Workspace user ID (immutable). */
  id: string;
  primaryEmail: string;
}

export interface CreatedOU {
  /** Full OU path including the parent (e.g. /Students/Spring2025). */
  ouPath: string;
}

export interface WorkspaceUser {
  id: string;
  primaryEmail: string;
  orgUnitPath: string;
  suspended?: boolean;
  fullName?: string | null;
}

export interface WorkspaceOU {
  /** Full OU path (e.g. /Students/Spring2025). */
  orgUnitPath: string;
  /** Display name of the OU (e.g. Spring2025). */
  name: string;
}

// ---------------------------------------------------------------------------
// GoogleWorkspaceAdminClient interface
// ---------------------------------------------------------------------------

/**
 * Abstraction over Google Admin Directory API operations.
 *
 * Implementations:
 *  - GoogleWorkspaceAdminClientImpl — real, uses googleapis + service account
 *  - FakeGoogleWorkspaceAdminClient — test double in tests/server/helpers/
 */
export interface GoogleWorkspaceAdminClient {
  // Read — used by sign-in handler (preserved from Sprint 002)
  getUserOU(email: string): Promise<string>;

  // Read — new in Sprint 006 (T005)
  listOUs(parentPath: string): Promise<WorkspaceOU[]>;

  // Write — new in Sprint 004
  createUser(params: CreateUserParams): Promise<CreatedUser>;
  createOU(name: string): Promise<CreatedOU>;
  suspendUser(email: string): Promise<void>;
  unsuspendUser(email: string): Promise<void>;
  deleteUser(email: string): Promise<void>;
  listUsersInOU(ouPath: string): Promise<WorkspaceUser[]>;
}

// ---------------------------------------------------------------------------
// GoogleWorkspaceAdminClientImpl — real implementation
// ---------------------------------------------------------------------------

// admin.directory.user covers both read and write (subsumes the .readonly
// variant). admin.directory.orgunit covers both read and write of OUs.
// We intentionally do NOT request .readonly variants — requesting a scope
// the service account has NOT been granted via domain-wide delegation
// causes Google to reject the token request with unauthorized_client.
const ADMIN_SDK_SCOPES = [
  'https://www.googleapis.com/auth/admin.directory.user',
  'https://www.googleapis.com/auth/admin.directory.orgunit',
];

/**
 * Real implementation of GoogleWorkspaceAdminClient using the Google Admin SDK.
 *
 * Authentication uses a Google service account with domain-wide delegation.
 * The service account must have all Admin SDK scopes granted in Google Workspace.
 *
 * Credential resolution (file path wins if both are set):
 *
 *   Option 1 — file path (preferred for local dev):
 *     new GoogleWorkspaceAdminClientImpl(
 *       '',
 *       process.env.GOOGLE_ADMIN_DELEGATED_USER_EMAIL!,
 *       process.env.GOOGLE_CRED_FILE,
 *     );
 *
 *   Option 2 — inline JSON string (preferred for Docker Swarm secrets):
 *     new GoogleWorkspaceAdminClientImpl(
 *       process.env.GOOGLE_SERVICE_ACCOUNT_JSON!,
 *       process.env.GOOGLE_ADMIN_DELEGATED_USER_EMAIL!,
 *     );
 *
 * Missing or malformed credentials do NOT prevent app startup. Errors are
 * deferred to the first method call.
 */
export class GoogleWorkspaceAdminClientImpl implements GoogleWorkspaceAdminClient {
  private readonly serviceAccountJson: string;
  private readonly delegatedUser: string;
  private readonly serviceAccountFile: string;

  constructor(serviceAccountJson: string, delegatedUser: string, serviceAccountFile = '') {
    this.serviceAccountJson = serviceAccountJson;
    this.delegatedUser = delegatedUser;
    this.serviceAccountFile = serviceAccountFile;
  }

  /**
   * Resolve the filesystem path from GOOGLE_CRED_FILE.
   *
   * Rules:
   *  - If the value contains a path separator (absolute or relative path),
   *    use it as-is (resolved against process.cwd() for relative paths).
   *  - If the value is a bare filename (no path separator), prepend
   *    `config/files/` relative to the project root (process.cwd()).
   */
  static resolveServiceAccountFilePath(fileValue: string): string {
    const hasSep = fileValue.includes('/') || fileValue.includes(path.sep);
    // Candidate base directories: cwd (server/) and its parent (repo root).
    // The dev server runs from server/, but the credentials file lives at
    // repo-root/config/files/, so relative paths in .env resolve correctly
    // from either anchor.
    const bases = [process.cwd(), path.resolve(process.cwd(), '..')];
    if (hasSep) {
      if (path.isAbsolute(fileValue)) return fileValue;
      for (const base of bases) {
        const candidate = path.resolve(base, fileValue);
        if (fs.existsSync(candidate)) return candidate;
      }
      return path.resolve(bases[0], fileValue);
    }
    for (const base of bases) {
      const candidate = path.resolve(base, 'config', 'files', fileValue);
      if (fs.existsSync(candidate)) return candidate;
    }
    return path.resolve(bases[0], 'config', 'files', fileValue);
  }

  /**
   * Resolve service account JSON string from either a file path or an inline
   * JSON string. File path takes precedence over inline JSON.
   *
   * @throws StaffOULookupError(MALFORMED_CREDENTIALS) if the file cannot be
   *         read or parsed.
   * @throws StaffOULookupError(MISSING_CREDENTIALS) if neither is provided.
   */
  private resolveServiceAccountJson(callerEmail: string): string {
    if (this.serviceAccountFile) {
      const resolvedPath = GoogleWorkspaceAdminClientImpl.resolveServiceAccountFilePath(
        this.serviceAccountFile,
      );
      let raw: string;
      try {
        raw = fs.readFileSync(resolvedPath, 'utf-8');
      } catch (readErr) {
        const msg =
          `[google-workspace-admin] Cannot read GOOGLE_CRED_FILE ` +
          `'${this.serviceAccountFile}' (resolved: '${resolvedPath}'). ` +
          `Cannot look up OU for ${callerEmail}. @jointheleague.org sign-in denied (RD-001).`;
        logger.error({ email: callerEmail, err: readErr }, msg);
        throw new StaffOULookupError(
          'Admin Directory service account JSON file cannot be read',
          'MALFORMED_CREDENTIALS',
          callerEmail,
          readErr,
        );
      }
      try {
        JSON.parse(raw);
      } catch (parseErr) {
        const msg =
          `[google-workspace-admin] GOOGLE_CRED_FILE ` +
          `'${this.serviceAccountFile}' (resolved: '${resolvedPath}') is not valid JSON. ` +
          `Cannot look up OU for ${callerEmail}. @jointheleague.org sign-in denied (RD-001).`;
        logger.error({ email: callerEmail, err: parseErr }, msg);
        throw new StaffOULookupError(
          'Admin Directory service account JSON file is malformed',
          'MALFORMED_CREDENTIALS',
          callerEmail,
          parseErr,
        );
      }
      logger.info(
        { email: callerEmail, source: 'GOOGLE_CRED_FILE', resolvedPath },
        '[google-workspace-admin] Using service account credentials from file.',
      );
      return raw;
    }

    if (this.serviceAccountJson) {
      logger.info(
        { email: callerEmail, source: 'GOOGLE_SERVICE_ACCOUNT_JSON' },
        '[google-workspace-admin] Using service account credentials from inline JSON.',
      );
      return this.serviceAccountJson;
    }

    const msg =
      '[google-workspace-admin] Neither GOOGLE_CRED_FILE nor ' +
      'GOOGLE_SERVICE_ACCOUNT_JSON is set. ' +
      `Cannot look up OU for ${callerEmail}. @jointheleague.org sign-in denied (RD-001).`;
    logger.error({ email: callerEmail }, msg);
    throw new StaffOULookupError(
      'Admin Directory credentials are not configured',
      'MISSING_CREDENTIALS',
      callerEmail,
    );
  }

  /**
   * Build an authenticated Admin SDK JWT client.
   * Shared by both read and write operations.
   *
   * @throws StaffOULookupError on credential resolution failures (for getUserOU)
   */
  private buildAuthClient(callerRef: string): InstanceType<typeof google.auth.JWT> {
    if (!this.serviceAccountFile && !this.serviceAccountJson) {
      const msg =
        '[google-workspace-admin] GOOGLE_SERVICE_ACCOUNT_JSON or ' +
        'GOOGLE_CRED_FILE and GOOGLE_ADMIN_DELEGATED_USER_EMAIL are missing. ' +
        `Cannot perform operation for ${callerRef}. Access denied (RD-001).`;
      logger.error({ ref: callerRef }, msg);
      throw new StaffOULookupError(
        'Admin Directory credentials are not configured',
        'MISSING_CREDENTIALS',
        callerRef,
      );
    }
    if (!this.delegatedUser) {
      const msg =
        '[google-workspace-admin] GOOGLE_ADMIN_DELEGATED_USER_EMAIL is missing. ' +
        `Cannot perform operation for ${callerRef}. Access denied (RD-001).`;
      logger.error({ ref: callerRef }, msg);
      throw new StaffOULookupError(
        'Admin Directory credentials are not configured',
        'MISSING_CREDENTIALS',
        callerRef,
      );
    }

    const resolvedJson = this.resolveServiceAccountJson(callerRef);

    let serviceAccountKey: Record<string, unknown>;
    try {
      serviceAccountKey = JSON.parse(resolvedJson) as Record<string, unknown>;
    } catch (parseErr) {
      const msg =
        '[google-workspace-admin] GOOGLE_SERVICE_ACCOUNT_JSON is not valid JSON. ' +
        `Cannot perform operation for ${callerRef}. Access denied (RD-001).`;
      logger.error({ ref: callerRef, err: parseErr }, msg);
      throw new StaffOULookupError(
        'Admin Directory service account JSON is malformed',
        'MALFORMED_CREDENTIALS',
        callerRef,
        parseErr,
      );
    }

    try {
      return new google.auth.JWT({
        email: serviceAccountKey['client_email'] as string,
        key: serviceAccountKey['private_key'] as string,
        scopes: ADMIN_SDK_SCOPES,
        subject: this.delegatedUser,
      });
    } catch (authErr) {
      const msg =
        '[google-workspace-admin] Failed to construct JWT auth client. ' +
        `Cannot perform operation for ${callerRef}.`;
      logger.error({ ref: callerRef, err: authErr }, msg);
      throw new StaffOULookupError(
        'Failed to initialise Admin Directory auth client',
        'AUTH_INIT_FAILED',
        callerRef,
        authErr,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Read methods (preserved from Sprint 002)
  // ---------------------------------------------------------------------------

  async getUserOU(email: string): Promise<string> {
    const auth = this.buildAuthClient(email);

    try {
      const adminSdk = google.admin({ version: 'directory_v1', auth });
      const response = await adminSdk.users.get({
        userKey: email,
        projection: 'basic',
      });

      const orgUnitPath = response.data.orgUnitPath;
      if (!orgUnitPath) {
        const msg =
          `[google-workspace-admin] users.get for ${email} returned no orgUnitPath.`;
        logger.error({ email }, msg);
        throw new StaffOULookupError(
          `No orgUnitPath returned for ${email}`,
          'MISSING_OU_PATH',
          email,
        );
      }

      return orgUnitPath;
    } catch (err) {
      if (err instanceof StaffOULookupError) {
        throw err;
      }
      const msg = `[google-workspace-admin] Admin SDK users.get failed for ${email}.`;
      logger.error({ email, err }, msg);
      throw new StaffOULookupError(
        `Admin Directory lookup failed for ${email}`,
        'API_ERROR',
        email,
        err,
      );
    }
  }

  async listOUs(parentPath: string): Promise<WorkspaceOU[]> {
    const auth = this.buildAuthClient(`listOUs:${parentPath}`);

    try {
      const adminSdk = google.admin({ version: 'directory_v1', auth });
      const response = await adminSdk.orgunits.list({
        customerId: 'my_customer',
        orgUnitPath: parentPath,
        type: 'children',
      });

      const ous: WorkspaceOU[] = [];
      for (const ou of response.data.organizationUnits ?? []) {
        if (ou.orgUnitPath && ou.name) {
          ous.push({ orgUnitPath: ou.orgUnitPath, name: ou.name });
        }
      }

      logger.info(
        { parentPath, count: ous.length },
        '[google-workspace-admin] listOUs: completed.',
      );

      return ous;
    } catch (err) {
      if (err instanceof StaffOULookupError) {
        throw err;
      }
      const apiErr = err as any;
      const statusCode: number | undefined = apiErr?.response?.status ?? apiErr?.code;
      logger.error({ parentPath, err }, '[google-workspace-admin] listOUs failed.');
      throw new WorkspaceApiError(
        `Admin SDK listOUs failed for '${parentPath}': ${apiErr?.message ?? String(err)}`,
        'listOUs',
        statusCode,
        err,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Guard helpers
  // ---------------------------------------------------------------------------

  /**
   * Throws WorkspaceWriteDisabledError if GOOGLE_WORKSPACE_WRITE_ENABLED is not "1".
   * Must be called as the first step of every write method.
   */
  private assertWriteEnabled(methodName: string): void {
    const flag = process.env.GOOGLE_WORKSPACE_WRITE_ENABLED;
    if (flag !== '1') {
      logger.error(
        { method: methodName, flag },
        '[google-workspace-admin] Write operation attempted but GOOGLE_WORKSPACE_WRITE_ENABLED is not "1".',
      );
      throw new WorkspaceWriteDisabledError();
    }
  }

  /**
   * Throws WorkspaceDomainGuardError if the email domain or OU path are outside
   * the configured student domain/OU root. Must be called in createUser.
   *
   * Uses resolveStudentDomain() and resolveStudentOuRoot() so League defaults
   * are applied consistently and logged at INFO when env vars are absent.
   */
  private assertStudentDomainAndOU(primaryEmail: string, orgUnitPath: string): void {
    const studentDomain = resolveStudentDomain();
    const studentOuRoot = resolveStudentOuRoot();

    const expectedSuffix = `@${studentDomain}`;
    if (!primaryEmail.endsWith(expectedSuffix)) {
      const reason = `primaryEmail "${primaryEmail}" does not end with "${expectedSuffix}"`;
      logger.error({ primaryEmail, studentDomain }, `[google-workspace-admin] Domain guard: ${reason}`);
      throw new WorkspaceDomainGuardError(reason);
    }

    if (!orgUnitPath.startsWith(studentOuRoot)) {
      const reason = `orgUnitPath "${orgUnitPath}" does not start with GOOGLE_STUDENT_OU_ROOT "${studentOuRoot}"`;
      logger.error({ orgUnitPath, studentOuRoot }, `[google-workspace-admin] OU guard: ${reason}`);
      throw new WorkspaceDomainGuardError(reason);
    }
  }

  // ---------------------------------------------------------------------------
  // Write methods (new in Sprint 004)
  // ---------------------------------------------------------------------------

  async createUser(params: CreateUserParams): Promise<CreatedUser> {
    this.assertWriteEnabled('createUser');
    const { primaryEmail, orgUnitPath, givenName, familyName, recoveryEmail } = params;
    this.assertStudentDomainAndOU(primaryEmail, orgUnitPath);
    // Note: sendNotificationEmail from params is recorded for callers' use but the
    // Admin SDK users.insert does not expose this as a direct parameter. Welcome
    // email delivery is governed by domain-level Google Workspace settings and is
    // routed to `recoveryEmail` when set — which the caller should populate with
    // the student's external primary email so the password lands somewhere they
    // can actually read.
    const auth = this.buildAuthClient(primaryEmail);

    try {
      const adminSdk = google.admin({ version: 'directory_v1', auth });
      const requestBody: Record<string, unknown> = {
        primaryEmail,
        orgUnitPath,
        name: { givenName, familyName },
        password: crypto.randomUUID(), // temporary password; user resets via welcome email
        changePasswordAtNextLogin: true,
      };
      if (recoveryEmail && recoveryEmail.trim() !== '') {
        requestBody.recoveryEmail = recoveryEmail.trim();
      }
      const response = await adminSdk.users.insert({ requestBody });

      const data = response.data;
      if (!data.id || !data.primaryEmail) {
        throw new WorkspaceApiError(
          `createUser response missing id or primaryEmail for ${primaryEmail}`,
          'createUser',
          (response as any).status,
        );
      }

      logger.info(
        { primaryEmail, id: data.id, orgUnitPath },
        '[google-workspace-admin] createUser: user created successfully.',
      );

      return { id: data.id, primaryEmail: data.primaryEmail };
    } catch (err) {
      if (err instanceof WorkspaceApiError || err instanceof WorkspaceWriteDisabledError || err instanceof WorkspaceDomainGuardError) {
        throw err;
      }
      const apiErr = err as any;
      const statusCode: number | undefined = apiErr?.response?.status ?? apiErr?.code;
      logger.error({ primaryEmail, err }, '[google-workspace-admin] createUser failed.');
      throw new WorkspaceApiError(
        `Admin SDK createUser failed for ${primaryEmail}: ${apiErr?.message ?? String(err)}`,
        'createUser',
        statusCode,
        err,
      );
    }
  }

  async createOU(name: string): Promise<CreatedOU> {
    this.assertWriteEnabled('createOU');
    const studentOuRoot = resolveStudentOuRoot();
    const auth = this.buildAuthClient(`createOU:${name}`);

    try {
      const adminSdk = google.admin({ version: 'directory_v1', auth });
      const response = await adminSdk.orgunits.insert({
        customerId: 'my_customer',
        requestBody: {
          name,
          parentOrgUnitPath: studentOuRoot,
        },
      });

      const ouPath = response.data.orgUnitPath;
      if (!ouPath) {
        throw new WorkspaceApiError(
          `createOU response missing orgUnitPath for OU name '${name}'`,
          'createOU',
          response.status,
        );
      }

      logger.info(
        { name, ouPath, parentOrgUnitPath: studentOuRoot },
        '[google-workspace-admin] createOU: OU created successfully.',
      );

      return { ouPath };
    } catch (err) {
      if (err instanceof WorkspaceApiError || err instanceof WorkspaceWriteDisabledError) {
        throw err;
      }
      const apiErr = err as any;
      const statusCode: number | undefined = apiErr?.response?.status ?? apiErr?.code;
      logger.error({ name, err }, '[google-workspace-admin] createOU failed.');
      throw new WorkspaceApiError(
        `Admin SDK createOU failed for '${name}': ${apiErr?.message ?? String(err)}`,
        'createOU',
        statusCode,
        err,
      );
    }
  }

  async suspendUser(email: string): Promise<void> {
    this.assertWriteEnabled('suspendUser');
    const auth = this.buildAuthClient(email);

    try {
      const adminSdk = google.admin({ version: 'directory_v1', auth });
      await adminSdk.users.update({
        userKey: email,
        requestBody: { suspended: true },
      });

      logger.info({ email }, '[google-workspace-admin] suspendUser: user suspended successfully.');
    } catch (err) {
      if (err instanceof WorkspaceWriteDisabledError) {
        throw err;
      }
      const apiErr = err as any;
      const statusCode: number | undefined = apiErr?.response?.status ?? apiErr?.code;
      logger.error({ email, err }, '[google-workspace-admin] suspendUser failed.');
      throw new WorkspaceApiError(
        `Admin SDK suspendUser failed for ${email}: ${apiErr?.message ?? String(err)}`,
        'suspendUser',
        statusCode,
        err,
      );
    }
  }

  async unsuspendUser(email: string): Promise<void> {
    this.assertWriteEnabled('unsuspendUser');
    const auth = this.buildAuthClient(email);

    try {
      const adminSdk = google.admin({ version: 'directory_v1', auth });
      await adminSdk.users.update({
        userKey: email,
        requestBody: { suspended: false },
      });

      logger.info({ email }, '[google-workspace-admin] unsuspendUser: user reactivated successfully.');
    } catch (err) {
      if (err instanceof WorkspaceWriteDisabledError) {
        throw err;
      }
      const apiErr = err as any;
      const statusCode: number | undefined = apiErr?.response?.status ?? apiErr?.code;
      logger.error({ email, err }, '[google-workspace-admin] unsuspendUser failed.');
      throw new WorkspaceApiError(
        `Admin SDK unsuspendUser failed for ${email}: ${apiErr?.message ?? String(err)}`,
        'unsuspendUser',
        statusCode,
        err,
      );
    }
  }

  async deleteUser(email: string): Promise<void> {
    this.assertWriteEnabled('deleteUser');
    const auth = this.buildAuthClient(email);

    try {
      const adminSdk = google.admin({ version: 'directory_v1', auth });
      await adminSdk.users.delete({
        userKey: email,
      });

      logger.info({ email }, '[google-workspace-admin] deleteUser: user deleted successfully.');
    } catch (err) {
      if (err instanceof WorkspaceWriteDisabledError) {
        throw err;
      }
      const apiErr = err as any;
      const statusCode: number | undefined = apiErr?.response?.status ?? apiErr?.code;
      logger.error({ email, err }, '[google-workspace-admin] deleteUser failed.');
      throw new WorkspaceApiError(
        `Admin SDK deleteUser failed for ${email}: ${apiErr?.message ?? String(err)}`,
        'deleteUser',
        statusCode,
        err,
      );
    }
  }

  async listUsersInOU(ouPath: string): Promise<WorkspaceUser[]> {
    const auth = this.buildAuthClient(`listUsersInOU:${ouPath}`);

    try {
      const adminSdk = google.admin({ version: 'directory_v1', auth });
      const users: WorkspaceUser[] = [];
      let pageToken: string | undefined;

      do {
        const response = await adminSdk.users.list({
          customer: 'my_customer',
          query: `orgUnitPath='${ouPath}'`,
          maxResults: 500,
          pageToken,
        });

        const data = response.data;
        for (const u of data.users ?? []) {
          if (u.id && u.primaryEmail && u.orgUnitPath) {
            users.push({
              id: u.id,
              primaryEmail: u.primaryEmail,
              orgUnitPath: u.orgUnitPath,
              suspended: u.suspended ?? false,
              fullName: u.name?.fullName ?? null,
            });
          }
        }
        pageToken = data.nextPageToken ?? undefined;
      } while (pageToken);

      logger.info(
        { ouPath, count: users.length },
        '[google-workspace-admin] listUsersInOU: completed.',
      );

      return users;
    } catch (err) {
      const apiErr = err as any;
      const statusCode: number | undefined = apiErr?.response?.status ?? apiErr?.code;
      logger.error({ ouPath, err }, '[google-workspace-admin] listUsersInOU failed.');
      throw new WorkspaceApiError(
        `Admin SDK listUsersInOU failed for '${ouPath}': ${apiErr?.message ?? String(err)}`,
        'listUsersInOU',
        statusCode,
        err,
      );
    }
  }
}
