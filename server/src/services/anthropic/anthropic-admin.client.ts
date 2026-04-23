/**
 * Anthropic Admin API client abstraction (Sprint 010 T002).
 *
 * Targets the real Anthropic Admin API endpoints, replacing the placeholder
 * endpoints in the old ClaudeTeamAdminClientImpl.
 *
 * Exports:
 *  - AnthropicAdminClient        — interface covering all org/workspace operations
 *  - AnthropicAdminClientImpl    — real implementation using fetch + x-api-key auth
 *  - AnthropicAdminApiError      — thrown on non-2xx HTTP responses
 *  - AnthropicAdminNotFoundError — thrown on 404 responses
 *  - AnthropicAdminWriteDisabledError — thrown when CLAUDE_TEAM_WRITE_ENABLED is not "1"
 *  - AnthropicUser               — org user record
 *  - AnthropicInvite             — org invite record
 *  - AnthropicWorkspace          — workspace record
 *  - InviteToOrgParams           — input type for inviteToOrg
 *
 * Environment variables read:
 *  - ANTHROPIC_ADMIN_API_KEY    — Primary API key (preferred)
 *  - CLAUDE_TEAM_API_KEY        — Legacy fallback API key
 *  - CLAUDE_TEAM_WRITE_ENABLED  — Must be exactly "1" to enable mutating calls
 *
 * Auth headers sent on every request:
 *  - x-api-key: <key>
 *  - anthropic-version: 2023-06-01
 *
 * Base URL: https://api.anthropic.com/v1
 */

import { createLogger } from '../logger.js';

const logger = createLogger('anthropic-admin');

// ---------------------------------------------------------------------------
// Anthropic Admin API base URL
// ---------------------------------------------------------------------------

const ANTHROPIC_API_BASE = 'https://api.anthropic.com/v1';
const ANTHROPIC_VERSION = '2023-06-01';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown on any non-2xx response from the Anthropic Admin API.
 * Subclasses specialise for well-known status codes.
 */
export class AnthropicAdminApiError extends Error {
  readonly statusCode?: number;
  readonly method: string;

  constructor(message: string, method: string, statusCode?: number, cause?: unknown) {
    super(message);
    this.name = 'AnthropicAdminApiError';
    this.method = method;
    this.statusCode = statusCode;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when the Anthropic Admin API returns 404.
 * Extends AnthropicAdminApiError so callers can catch either class.
 */
export class AnthropicAdminNotFoundError extends AnthropicAdminApiError {
  constructor(message: string, method: string, cause?: unknown) {
    super(message, method, 404, cause);
    this.name = 'AnthropicAdminNotFoundError';
  }
}

/**
 * Thrown when a mutating method is called but CLAUDE_TEAM_WRITE_ENABLED is
 * not set to exactly "1". This is a safety kill switch against accidental writes.
 */
export class AnthropicAdminWriteDisabledError extends Error {
  constructor() {
    super(
      'Anthropic Admin write operations are disabled. ' +
        'Set CLAUDE_TEAM_WRITE_ENABLED=1 to enable them.',
    );
    this.name = 'AnthropicAdminWriteDisabledError';
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/** An Anthropic organization user record. */
export interface AnthropicUser {
  id: string;
  email: string;
  role: string;
  name?: string;
}

/** An Anthropic organization invite record. */
export interface AnthropicInvite {
  id: string;
  email: string;
  role: string;
  status: string;
  expires_at?: string;
}

/** An Anthropic workspace record. */
export interface AnthropicWorkspace {
  id: string;
  name: string;
}

/** Paginated list response shape used by listOrgUsers and listInvites. */
export interface AnthropicPagedResult<T> {
  data: T[];
  nextCursor?: string;
}

/** Input parameters for inviteToOrg. */
export interface InviteToOrgParams {
  email: string;
  role?: string;
}

// ---------------------------------------------------------------------------
// AnthropicAdminClient interface
// ---------------------------------------------------------------------------

/**
 * Abstraction over Anthropic Admin API operations.
 *
 * Implementations:
 *  - AnthropicAdminClientImpl — real, uses fetch against the Anthropic Admin API
 *  - FakeAnthropicAdminClient — test double (implemented in T008)
 */
export interface AnthropicAdminClient {
  // ---------------------------------------------------------------------------
  // Organization users
  // ---------------------------------------------------------------------------

  /**
   * List members of the organization.
   * Read-only — does not require CLAUDE_TEAM_WRITE_ENABLED.
   *
   * @param cursor Optional pagination cursor from a previous response.
   */
  listOrgUsers(cursor?: string): Promise<AnthropicPagedResult<AnthropicUser>>;

  /**
   * Get a single organization user by their user ID.
   * Read-only — does not require CLAUDE_TEAM_WRITE_ENABLED.
   *
   * @throws AnthropicAdminNotFoundError if the user does not exist.
   */
  getOrgUser(userId: string): Promise<AnthropicUser>;

  /**
   * Delete (remove) a user from the organization.
   * Requires CLAUDE_TEAM_WRITE_ENABLED=1.
   *
   * @throws AnthropicAdminWriteDisabledError if the kill switch is active.
   * @throws AnthropicAdminNotFoundError if the user does not exist.
   */
  deleteOrgUser(userId: string): Promise<void>;

  // ---------------------------------------------------------------------------
  // Invites
  // ---------------------------------------------------------------------------

  /**
   * Invite a new user to the organization by email.
   * Requires CLAUDE_TEAM_WRITE_ENABLED=1.
   *
   * @throws AnthropicAdminWriteDisabledError if the kill switch is active.
   */
  inviteToOrg(params: InviteToOrgParams): Promise<AnthropicInvite>;

  /**
   * List pending invites for the organization.
   * Read-only — does not require CLAUDE_TEAM_WRITE_ENABLED.
   *
   * @param cursor Optional pagination cursor from a previous response.
   */
  listInvites(cursor?: string): Promise<AnthropicPagedResult<AnthropicInvite>>;

  /**
   * Cancel (delete) a pending invite by its invite ID.
   * Requires CLAUDE_TEAM_WRITE_ENABLED=1.
   *
   * @throws AnthropicAdminWriteDisabledError if the kill switch is active.
   * @throws AnthropicAdminNotFoundError if the invite does not exist.
   */
  cancelInvite(inviteId: string): Promise<void>;

  // ---------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------

  /**
   * List all workspaces in the organization.
   * Read-only — does not require CLAUDE_TEAM_WRITE_ENABLED.
   */
  listWorkspaces(): Promise<AnthropicWorkspace[]>;

  /**
   * Add a user to a workspace.
   * Requires CLAUDE_TEAM_WRITE_ENABLED=1.
   *
   * @throws AnthropicAdminWriteDisabledError if the kill switch is active.
   * @throws AnthropicAdminNotFoundError if the workspace or user does not exist.
   */
  addUserToWorkspace(workspaceId: string, userId: string, role?: string): Promise<void>;

  /**
   * Remove a user from a workspace.
   * Requires CLAUDE_TEAM_WRITE_ENABLED=1.
   *
   * @throws AnthropicAdminWriteDisabledError if the kill switch is active.
   * @throws AnthropicAdminNotFoundError if the workspace or membership does not exist.
   */
  removeUserFromWorkspace(workspaceId: string, userId: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// AnthropicAdminClientImpl — real implementation
// ---------------------------------------------------------------------------

/**
 * Real implementation of AnthropicAdminClient using the Anthropic Admin API.
 *
 * Authentication: x-api-key header. Resolves from ANTHROPIC_ADMIN_API_KEY
 * first; falls back to CLAUDE_TEAM_API_KEY.
 *
 * Missing or invalid credentials do NOT prevent app startup. Errors are
 * deferred to the first method call that requires the key.
 */
export class AnthropicAdminClientImpl implements AnthropicAdminClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  // ---------------------------------------------------------------------------
  // Guard helpers
  // ---------------------------------------------------------------------------

  /**
   * Throws AnthropicAdminWriteDisabledError if CLAUDE_TEAM_WRITE_ENABLED is
   * not exactly "1". Must be the first statement in every mutating method.
   */
  private assertWriteEnabled(methodName: string): void {
    const flag = process.env.CLAUDE_TEAM_WRITE_ENABLED;
    if (flag !== '1') {
      logger.error(
        { method: methodName, flag },
        '[anthropic-admin] Write operation attempted but CLAUDE_TEAM_WRITE_ENABLED is not "1".',
      );
      throw new AnthropicAdminWriteDisabledError();
    }
  }

  /**
   * Build common request headers for the Anthropic Admin API.
   * Uses x-api-key (not Authorization: Bearer).
   */
  private buildHeaders(): Record<string, string> {
    return {
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
      'content-type': 'application/json',
    };
  }

  /**
   * Make an authenticated request to the Anthropic Admin API.
   * Parses the response as JSON and throws typed errors on non-2xx status.
   *
   * @throws AnthropicAdminNotFoundError on 404
   * @throws AnthropicAdminApiError on other non-2xx responses or network errors
   */
  private async request<T>(
    method: string,
    path: string,
    callerMethod: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${ANTHROPIC_API_BASE}${path}`;
    let response: Response;

    try {
      response = await fetch(url, {
        method,
        headers: this.buildHeaders(),
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
    } catch (networkErr) {
      logger.error(
        { url, method, callerMethod, err: networkErr },
        '[anthropic-admin] Network error calling Anthropic Admin API.',
      );
      throw new AnthropicAdminApiError(
        `Network error calling Anthropic Admin API (${callerMethod}): ${String(networkErr)}`,
        callerMethod,
        undefined,
        networkErr,
      );
    }

    if (response.status === 404) {
      let errBody: unknown;
      try { errBody = await response.json(); } catch { errBody = null; }
      logger.warn(
        { url, method, callerMethod, status: 404, body: errBody },
        '[anthropic-admin] Anthropic Admin API returned 404.',
      );
      throw new AnthropicAdminNotFoundError(
        `Anthropic Admin API 404 (${callerMethod})`,
        callerMethod,
      );
    }

    if (!response.ok) {
      let errBody: unknown;
      try { errBody = await response.json(); } catch { errBody = null; }
      logger.error(
        { url, method, callerMethod, status: response.status, body: errBody },
        '[anthropic-admin] Anthropic Admin API returned non-2xx status.',
      );
      throw new AnthropicAdminApiError(
        `Anthropic Admin API error ${response.status} (${callerMethod})`,
        callerMethod,
        response.status,
      );
    }

    // 204 No Content — return empty object cast to T
    if (response.status === 204) {
      return {} as T;
    }

    try {
      return (await response.json()) as T;
    } catch (parseErr) {
      logger.error(
        { url, method, callerMethod, err: parseErr },
        '[anthropic-admin] Failed to parse Anthropic Admin API response as JSON.',
      );
      throw new AnthropicAdminApiError(
        `Failed to parse Anthropic Admin API response (${callerMethod})`,
        callerMethod,
        response.status,
        parseErr,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Organization users
  // ---------------------------------------------------------------------------

  async listOrgUsers(cursor?: string): Promise<AnthropicPagedResult<AnthropicUser>> {
    logger.info({ cursor }, '[anthropic-admin] listOrgUsers: fetching org users.');

    const path = cursor
      ? `/organizations/users?starting_after=${encodeURIComponent(cursor)}`
      : '/organizations/users';

    const result = await this.request<{ data?: AnthropicUser[]; has_more?: boolean; last_id?: string }>(
      'GET',
      path,
      'listOrgUsers',
    );

    const users = result.data ?? [];
    const nextCursor = result.has_more ? result.last_id : undefined;

    logger.info({ count: users.length, hasMore: result.has_more }, '[anthropic-admin] listOrgUsers: completed.');

    return { data: users, nextCursor };
  }

  async getOrgUser(userId: string): Promise<AnthropicUser> {
    logger.info({ userId }, '[anthropic-admin] getOrgUser: fetching user.');

    const user = await this.request<AnthropicUser>(
      'GET',
      `/organizations/users/${userId}`,
      'getOrgUser',
    );

    logger.info({ userId, email: user.email }, '[anthropic-admin] getOrgUser: completed.');

    return user;
  }

  async deleteOrgUser(userId: string): Promise<void> {
    this.assertWriteEnabled('deleteOrgUser');

    logger.info({ userId }, '[anthropic-admin] deleteOrgUser: deleting org user.');

    await this.request<void>(
      'DELETE',
      `/organizations/users/${userId}`,
      'deleteOrgUser',
    );

    logger.info({ userId }, '[anthropic-admin] deleteOrgUser: user deleted.');
  }

  // ---------------------------------------------------------------------------
  // Invites
  // ---------------------------------------------------------------------------

  async inviteToOrg(params: InviteToOrgParams): Promise<AnthropicInvite> {
    this.assertWriteEnabled('inviteToOrg');

    logger.info({ email: params.email, role: params.role }, '[anthropic-admin] inviteToOrg: sending invite.');

    const invite = await this.request<AnthropicInvite>(
      'POST',
      '/organizations/invites',
      'inviteToOrg',
      { email: params.email, role: params.role ?? 'user' },
    );

    logger.info(
      { email: params.email, inviteId: invite.id, status: invite.status },
      '[anthropic-admin] inviteToOrg: invite sent.',
    );

    return invite;
  }

  async listInvites(cursor?: string): Promise<AnthropicPagedResult<AnthropicInvite>> {
    logger.info({ cursor }, '[anthropic-admin] listInvites: fetching invites.');

    const path = cursor
      ? `/organizations/invites?starting_after=${encodeURIComponent(cursor)}`
      : '/organizations/invites';

    const result = await this.request<{ data?: AnthropicInvite[]; has_more?: boolean; last_id?: string }>(
      'GET',
      path,
      'listInvites',
    );

    const invites = result.data ?? [];
    const nextCursor = result.has_more ? result.last_id : undefined;

    logger.info({ count: invites.length, hasMore: result.has_more }, '[anthropic-admin] listInvites: completed.');

    return { data: invites, nextCursor };
  }

  async cancelInvite(inviteId: string): Promise<void> {
    this.assertWriteEnabled('cancelInvite');

    logger.info({ inviteId }, '[anthropic-admin] cancelInvite: cancelling invite.');

    await this.request<void>(
      'DELETE',
      `/organizations/invites/${inviteId}`,
      'cancelInvite',
    );

    logger.info({ inviteId }, '[anthropic-admin] cancelInvite: invite cancelled.');
  }

  // ---------------------------------------------------------------------------
  // Workspaces
  // ---------------------------------------------------------------------------

  async listWorkspaces(): Promise<AnthropicWorkspace[]> {
    logger.info('[anthropic-admin] listWorkspaces: fetching workspaces.');

    const result = await this.request<{ data?: AnthropicWorkspace[] }>(
      'GET',
      '/organizations/workspaces',
      'listWorkspaces',
    );

    const workspaces = result.data ?? [];

    logger.info({ count: workspaces.length }, '[anthropic-admin] listWorkspaces: completed.');

    return workspaces;
  }

  async addUserToWorkspace(workspaceId: string, userId: string, role?: string): Promise<void> {
    this.assertWriteEnabled('addUserToWorkspace');

    logger.info({ workspaceId, userId, role }, '[anthropic-admin] addUserToWorkspace: adding user to workspace.');

    await this.request<void>(
      'POST',
      `/organizations/workspaces/${workspaceId}/members`,
      'addUserToWorkspace',
      { user_id: userId, workspace_role: role ?? 'workspace_user' },
    );

    logger.info({ workspaceId, userId }, '[anthropic-admin] addUserToWorkspace: user added.');
  }

  async removeUserFromWorkspace(workspaceId: string, userId: string): Promise<void> {
    this.assertWriteEnabled('removeUserFromWorkspace');

    logger.info({ workspaceId, userId }, '[anthropic-admin] removeUserFromWorkspace: removing user from workspace.');

    await this.request<void>(
      'DELETE',
      `/organizations/workspaces/${workspaceId}/members/${userId}`,
      'removeUserFromWorkspace',
    );

    logger.info({ workspaceId, userId }, '[anthropic-admin] removeUserFromWorkspace: user removed.');
  }
}

// ---------------------------------------------------------------------------
// Factory helper
// ---------------------------------------------------------------------------

/**
 * Resolve the Anthropic Admin API key from environment variables.
 * Prefers ANTHROPIC_ADMIN_API_KEY; falls back to CLAUDE_TEAM_API_KEY.
 * Returns an empty string if neither is set (errors deferred to first call).
 */
export function resolveAnthropicAdminApiKey(): string {
  return process.env.ANTHROPIC_ADMIN_API_KEY ?? process.env.CLAUDE_TEAM_API_KEY ?? '';
}
