/**
 * Claude Team Admin client abstraction (Sprint 005 T002).
 *
 * Provides an API layer for all Claude Team seat-management operations:
 * invite member, suspend member, remove member, and list members.
 *
 * Follows the same patterns as GoogleWorkspaceAdminClient (Sprint 004):
 * typed interface, write-enable flag, typed error classes, no business logic.
 *
 * Exports:
 *  - ClaudeTeamAdminClient       — interface covering all operations
 *  - ClaudeTeamAdminClientImpl   — real implementation using fetch + Claude Team API
 *  - ClaudeTeamWriteDisabledError — thrown when CLAUDE_TEAM_WRITE_ENABLED is not "1"
 *  - ClaudeTeamApiError           — thrown on non-2xx HTTP responses
 *  - ClaudeTeamMemberNotFoundError — thrown when a member is not found (404)
 *  - InviteMemberParams           — input type for inviteMember
 *  - ClaudeTeamMember             — element type for listMembers
 *
 * Environment variables read:
 *  - CLAUDE_TEAM_API_KEY        — API key for the Claude Team API (required for all calls)
 *  - CLAUDE_TEAM_PRODUCT_ID     — The Claude Team product/organization ID (required for all calls)
 *  - CLAUDE_TEAM_WRITE_ENABLED  — Must be exactly "1" to enable mutating calls
 *
 * Open questions (OQ) documented here for future resolution:
 *
 *  OQ-001: inviteMember response status
 *    The Claude Team API invite endpoint may return the new member with status
 *    "active" or "pending" depending on whether the invitee already has an
 *    Anthropic account. Callers should inspect the returned ClaudeTeamMember.status
 *    field rather than assuming a particular value. This will be confirmed once
 *    the real API is exercised.
 *
 *  OQ-002: env var names
 *    CLAUDE_TEAM_API_KEY and CLAUDE_TEAM_PRODUCT_ID may need revision once the
 *    actual Claude Team API documentation is consulted. The API key format and
 *    the correct identifier for an organization/team may differ from what is
 *    assumed here. Review and update env var names before production deployment.
 *
 *  OQ-003: suspend operation
 *    The Claude Team API may not have a first-class "suspend" endpoint distinct
 *    from seat removal. If no such endpoint exists, suspendMember is implemented
 *    as a documented no-op and this should be revisited. The interface retains the
 *    method so callers compile without change if a real implementation is added.
 */

import pino from 'pino';

const logger = pino({ name: 'claude-team-admin' });

// ---------------------------------------------------------------------------
// Claude Team API base URL
// ---------------------------------------------------------------------------

/**
 * Base URL for the Claude Team API.
 *
 * OQ-002: This URL will need verification against real API documentation.
 * Anthropic does not currently publish a public Claude Team management API;
 * this is a placeholder based on the standard Anthropic API base URL.
 */
const CLAUDE_TEAM_API_BASE = 'https://api.anthropic.com/v1';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown when a mutating method (inviteMember, suspendMember, removeMember)
 * is called but CLAUDE_TEAM_WRITE_ENABLED is not set to exactly "1".
 *
 * Mirrors WorkspaceWriteDisabledError from the Google Workspace client.
 */
export class ClaudeTeamWriteDisabledError extends Error {
  constructor() {
    super(
      'Claude Team write operations are disabled. ' +
        'Set CLAUDE_TEAM_WRITE_ENABLED=1 to enable them.',
    );
    this.name = 'ClaudeTeamWriteDisabledError';
  }
}

/**
 * Thrown when the Claude Team API returns a non-2xx HTTP response.
 */
export class ClaudeTeamApiError extends Error {
  readonly statusCode?: number;
  readonly method: string;

  constructor(message: string, method: string, statusCode?: number, cause?: unknown) {
    super(message);
    this.name = 'ClaudeTeamApiError';
    this.method = method;
    this.statusCode = statusCode;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when a member lookup or removal targets a member ID that does not
 * exist in the Claude Team (HTTP 404 from the API).
 */
export class ClaudeTeamMemberNotFoundError extends Error {
  readonly memberId: string;

  constructor(memberId: string, method: string, cause?: unknown) {
    super(`Claude Team member not found: ${memberId} (method: ${method})`);
    this.name = 'ClaudeTeamMemberNotFoundError';
    this.memberId = memberId;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface InviteMemberParams {
  /** Email address of the person to invite. */
  email: string;
  /**
   * The role to assign to the new member.
   * OQ-002: Confirm valid role values from the Claude Team API docs.
   */
  role?: string;
}

/**
 * A member record as returned by the Claude Team API.
 *
 * OQ-001: The `status` field may be "active" or "pending" depending on whether
 * the invitee already has an Anthropic account at invite time. Callers should
 * not assume a value; inspect this field at call time.
 *
 * OQ-002: Field names will need verification against real API documentation.
 */
export interface ClaudeTeamMember {
  /** Unique identifier for the team member (assigned by the Claude Team API). */
  id: string;
  /** Email address of the member. */
  email: string;
  /**
   * Membership status. Known values: "active", "pending".
   * See OQ-001 for details on when each value is returned.
   */
  status: string;
  /** Role of the member within the team (e.g., "user", "admin"). */
  role?: string;
}

// ---------------------------------------------------------------------------
// ClaudeTeamAdminClient interface
// ---------------------------------------------------------------------------

/**
 * Abstraction over Claude Team seat-management operations.
 *
 * Implementations:
 *  - ClaudeTeamAdminClientImpl  — real, uses fetch against the Claude Team API
 *  - FakeClaudeTeamAdminClient  — test double in tests/server/helpers/
 */
export interface ClaudeTeamAdminClient {
  /**
   * Invite a new member to the Claude Team by email.
   *
   * Requires CLAUDE_TEAM_WRITE_ENABLED=1.
   * Throws ClaudeTeamWriteDisabledError if the flag is not set.
   * Throws ClaudeTeamApiError on non-2xx API responses.
   *
   * OQ-001: The returned member's status may be "active" or "pending".
   */
  inviteMember(params: InviteMemberParams): Promise<ClaudeTeamMember>;

  /**
   * Suspend a member by their member ID.
   *
   * OQ-003: If the Claude Team API does not have a first-class suspend endpoint,
   * this is implemented as a no-op. Check the implementation for the current
   * behaviour and update once the real API is confirmed.
   *
   * Requires CLAUDE_TEAM_WRITE_ENABLED=1.
   * Throws ClaudeTeamWriteDisabledError if the flag is not set.
   * Throws ClaudeTeamMemberNotFoundError if memberId does not exist.
   * Throws ClaudeTeamApiError on other non-2xx API responses.
   */
  suspendMember(memberId: string): Promise<void>;

  /**
   * Remove a member from the Claude Team by their member ID.
   *
   * Requires CLAUDE_TEAM_WRITE_ENABLED=1.
   * Throws ClaudeTeamWriteDisabledError if the flag is not set.
   * Throws ClaudeTeamMemberNotFoundError if memberId does not exist.
   * Throws ClaudeTeamApiError on other non-2xx API responses.
   */
  removeMember(memberId: string): Promise<void>;

  /**
   * List all current members of the Claude Team.
   *
   * Does NOT require CLAUDE_TEAM_WRITE_ENABLED (read-only operation).
   * Throws ClaudeTeamApiError on non-2xx API responses.
   */
  listMembers(): Promise<ClaudeTeamMember[]>;
}

// ---------------------------------------------------------------------------
// ClaudeTeamAdminClientImpl — real implementation
// ---------------------------------------------------------------------------

/**
 * Real implementation of ClaudeTeamAdminClient using the Claude Team API.
 *
 * Authentication uses an API key passed in the Authorization header.
 *
 * Missing or invalid credentials do NOT prevent app startup. Errors are
 * deferred to the first method call.
 *
 * OQ-002: The API key format and organization identifier (CLAUDE_TEAM_PRODUCT_ID)
 * may need revision once real API documentation is available.
 *
 * OQ-003: suspendMember is currently a documented no-op because the Claude Team
 * API has no dedicated suspend endpoint distinct from removal. If Anthropic adds
 * one in future, replace the no-op body with the real call.
 */
export class ClaudeTeamAdminClientImpl implements ClaudeTeamAdminClient {
  private readonly apiKey: string;
  private readonly productId: string;

  constructor(apiKey: string, productId: string) {
    this.apiKey = apiKey;
    this.productId = productId;
  }

  // ---------------------------------------------------------------------------
  // Guard helpers
  // ---------------------------------------------------------------------------

  /**
   * Throws ClaudeTeamWriteDisabledError if CLAUDE_TEAM_WRITE_ENABLED is not "1".
   * Must be called as the first step of every mutating method.
   */
  private assertWriteEnabled(methodName: string): void {
    const flag = process.env.CLAUDE_TEAM_WRITE_ENABLED;
    if (flag !== '1') {
      logger.error(
        { method: methodName, flag },
        '[claude-team-admin] Write operation attempted but CLAUDE_TEAM_WRITE_ENABLED is not "1".',
      );
      throw new ClaudeTeamWriteDisabledError();
    }
  }

  /**
   * Build common request headers for the Claude Team API.
   */
  private buildHeaders(): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'anthropic-version': '2023-06-01',
    };
  }

  /**
   * Make an authenticated request to the Claude Team API.
   * Parses the response as JSON and throws typed errors on non-2xx status.
   *
   * @throws ClaudeTeamMemberNotFoundError on 404
   * @throws ClaudeTeamApiError on other non-2xx responses or network errors
   */
  private async request<T>(
    method: string,
    path: string,
    callerMethod: string,
    body?: unknown,
  ): Promise<T> {
    const url = `${CLAUDE_TEAM_API_BASE}${path}`;
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
        '[claude-team-admin] Network error calling Claude Team API.',
      );
      throw new ClaudeTeamApiError(
        `Network error calling Claude Team API (${callerMethod}): ${String(networkErr)}`,
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
        '[claude-team-admin] Claude Team API returned 404.',
      );
      // The caller will wrap this in ClaudeTeamMemberNotFoundError where appropriate.
      throw new ClaudeTeamApiError(
        `Claude Team API 404 (${callerMethod})`,
        callerMethod,
        404,
      );
    }

    if (!response.ok) {
      let errBody: unknown;
      try { errBody = await response.json(); } catch { errBody = null; }
      logger.error(
        { url, method, callerMethod, status: response.status, body: errBody },
        '[claude-team-admin] Claude Team API returned non-2xx status.',
      );
      throw new ClaudeTeamApiError(
        `Claude Team API error ${response.status} (${callerMethod})`,
        callerMethod,
        response.status,
      );
    }

    // 204 No Content — return empty object
    if (response.status === 204) {
      return {} as T;
    }

    try {
      return (await response.json()) as T;
    } catch (parseErr) {
      logger.error(
        { url, method, callerMethod, err: parseErr },
        '[claude-team-admin] Failed to parse Claude Team API response as JSON.',
      );
      throw new ClaudeTeamApiError(
        `Failed to parse Claude Team API response (${callerMethod})`,
        callerMethod,
        response.status,
        parseErr,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Public methods
  // ---------------------------------------------------------------------------

  async inviteMember(params: InviteMemberParams): Promise<ClaudeTeamMember> {
    this.assertWriteEnabled('inviteMember');

    logger.info(
      { email: params.email, productId: this.productId },
      '[claude-team-admin] inviteMember: sending invite.',
    );

    // OQ-002: Endpoint path and request body shape need verification against
    // real Claude Team API documentation.
    const member = await this.request<ClaudeTeamMember>(
      'POST',
      `/organizations/${this.productId}/members`,
      'inviteMember',
      { email: params.email, role: params.role ?? 'user' },
    );

    // OQ-001: member.status may be "active" or "pending" — log it so we can
    // confirm actual API behaviour in staging.
    logger.info(
      { email: params.email, id: member.id, status: member.status },
      '[claude-team-admin] inviteMember: invite sent.',
    );

    return member;
  }

  async suspendMember(memberId: string): Promise<void> {
    this.assertWriteEnabled('suspendMember');

    // OQ-003: The Claude Team API does not appear to have a dedicated suspend
    // endpoint separate from member removal. This method is a documented no-op
    // until a real suspend API is confirmed. Log a warning so operators know
    // no action was taken.
    logger.warn(
      { memberId },
      '[claude-team-admin] suspendMember: no-op — Claude Team API has no suspend ' +
        'endpoint distinct from removal (OQ-003). Member was NOT suspended or removed.',
    );
  }

  async removeMember(memberId: string): Promise<void> {
    this.assertWriteEnabled('removeMember');

    logger.info(
      { memberId, productId: this.productId },
      '[claude-team-admin] removeMember: removing member.',
    );

    // OQ-002: Endpoint path needs verification against real API documentation.
    try {
      await this.request<void>(
        'DELETE',
        `/organizations/${this.productId}/members/${memberId}`,
        'removeMember',
      );
    } catch (err) {
      if (err instanceof ClaudeTeamApiError && err.statusCode === 404) {
        throw new ClaudeTeamMemberNotFoundError(memberId, 'removeMember', err);
      }
      throw err;
    }

    logger.info(
      { memberId },
      '[claude-team-admin] removeMember: member removed.',
    );
  }

  async listMembers(): Promise<ClaudeTeamMember[]> {
    logger.info(
      { productId: this.productId },
      '[claude-team-admin] listMembers: fetching members.',
    );

    // OQ-002: Endpoint path and response shape need verification against
    // real Claude Team API documentation. The response may be paginated.
    const result = await this.request<{ members?: ClaudeTeamMember[]; data?: ClaudeTeamMember[] }>(
      'GET',
      `/organizations/${this.productId}/members`,
      'listMembers',
    );

    // Handle both common API shapes: { members: [...] } and { data: [...] }
    const members = result.members ?? result.data ?? [];

    logger.info(
      { count: members.length },
      '[claude-team-admin] listMembers: completed.',
    );

    return members;
  }
}
