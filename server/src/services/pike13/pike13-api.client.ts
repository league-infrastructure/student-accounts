/**
 * Pike13 API client abstraction (Sprint 006 T001).
 *
 * Provides all Pike13 REST API operations needed by the sync (UC-004) and
 * write-back (UC-020) features. This is the foundation layer; no Pike13 work
 * can proceed without it.
 *
 * Exports:
 *  - Pike13ApiClient           — interface covering all operations
 *  - Pike13ApiClientImpl       — real implementation using fetch + Bearer token
 *  - Pike13WriteDisabledError  — thrown when PIKE13_WRITE_ENABLED is not "1"
 *  - Pike13ApiError            — thrown on any HTTP error response
 *  - Pike13PersonNotFoundError — thrown when a person ID does not exist (404)
 *  - Pike13Person              — a single person record from the API
 *  - Pike13PeoplePage          — paginated result from listPeople
 *
 * Environment variables read:
 *  - PIKE13_ACCESS_TOKEN  — OAuth access token for the Pike13 API (required)
 *  - PIKE13_API_URL       — Base URL for the Pike13 API; defaults to
 *                           https://pike13.com/api/v2/desk (see note below)
 *  - PIKE13_WRITE_ENABLED — Must be exactly "1" to allow write calls
 *                           (updateCustomField). Read operations (listPeople,
 *                           getPerson) are not affected.
 *
 * Open questions (OQ) documented for future resolution:
 *
 *  OQ-001: Pagination style
 *    The Pike13 API pagination style is unconfirmed. This implementation
 *    assumes a cursor-based scheme where the response body contains a
 *    `next_cursor` string (or null/absent when on the last page) and the
 *    client passes `?cursor=<value>` on subsequent requests. If the real
 *    API uses page-number or offset pagination the `listPeople` method and
 *    the `Pike13PeoplePage` type will need revision.
 *
 *    Assumed request shape:  GET /people?cursor=<opaque-string>&per_page=100
 *    Assumed response shape: { people: [...], next_cursor: "string" | null }
 *
 *  OQ-002: Custom field update endpoint
 *    The custom field update endpoint shape is unconfirmed. This
 *    implementation assumes:
 *      PATCH /people/<personId>/custom_fields/<fieldId>
 *      Body: { value: "<string>" }
 *    If the real API uses a different path or body format this will need
 *    revision post-hoc.
 *
 *  OQ-003: Authentication scheme
 *    Pike13 access tokens obtained via the OAuth2 authorization-code flow do
 *    not expire. They are sent as a Bearer token in the Authorization header.
 *    If the real API requires a different header name or scheme (e.g.,
 *    X-Api-Token) update buildHeaders() accordingly.
 *
 *  OQ-004: Person object fields
 *    The exact fields returned by the Pike13 people endpoint are unknown.
 *    Pike13Person captures the fields most likely to be available based on
 *    typical CRM APIs. Extend this interface once the real API shape is
 *    confirmed.
 *
 * Design decisions:
 *  - Follows the same patterns as GoogleWorkspaceAdminClient (Sprint 004) and
 *    ClaudeTeamAdminClient (Sprint 005): typed interface, write-enable flag,
 *    typed error classes, no business logic inside the client.
 *  - PIKE13_API_URL defaults to https://pike13.com/api/v2/desk per the
 *    api-integrations.md rule. Set PIKE13_API_URL (not PIKE13_API_BASE, per
 *    the ticket acceptance criteria) to override for subdomain businesses.
 *    Note: the rule mentions PIKE13_API_BASE as an alternative name; the
 *    ticket acceptance criteria specifies PIKE13_API_URL — PIKE13_API_URL wins
 *    when set; PIKE13_API_BASE is accepted as a fallback alias.
 *  - Missing credentials do NOT prevent app startup. Errors are deferred to
 *    the first method call.
 */

import { createLogger } from '../logger.js';

const logger = createLogger('pike13-api');

// ---------------------------------------------------------------------------
// Default API base URL
// ---------------------------------------------------------------------------

/**
 * Default Pike13 API base URL per api-integrations.md.
 * Override with PIKE13_API_URL (or the legacy alias PIKE13_API_BASE) when
 * the business uses a custom subdomain.
 *
 * OQ-001 / OQ-002: The specific endpoint paths under this base are
 * inferred and will need verification against real API documentation.
 */
export const DEFAULT_PIKE13_API_URL = 'https://pike13.com/api/v2/desk';

/**
 * Resolve the Pike13 API base URL from environment variables.
 *
 * Preference order:
 *  1. PIKE13_API_URL (preferred, per ticket acceptance criteria)
 *  2. PIKE13_API_BASE (legacy alias from api-integrations.md)
 *  3. DEFAULT_PIKE13_API_URL constant
 */
export function resolvePike13ApiUrl(): string {
  return (
    process.env.PIKE13_API_URL ||
    process.env.PIKE13_API_BASE ||
    DEFAULT_PIKE13_API_URL
  );
}

/**
 * Derive the OAuth token endpoint from the API URL.
 * For https://jtl.pike13.com/api/v2/desk → https://jtl.pike13.com/oauth/token.
 * The caller may override with PIKE13_OAUTH_TOKEN_URL if the inference is wrong.
 */
export function deriveOauthTokenUrl(apiUrl: string): string {
  const override = process.env.PIKE13_OAUTH_TOKEN_URL;
  if (override) return override;
  try {
    const parsed = new URL(apiUrl);
    return `${parsed.protocol}//${parsed.host}/oauth/token`;
  } catch {
    return 'https://pike13.com/oauth/token';
  }
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown when updateCustomField is called but PIKE13_WRITE_ENABLED is not set
 * to exactly "1". Mirrors WorkspaceWriteDisabledError from the Google
 * Workspace client.
 */
export class Pike13WriteDisabledError extends Error {
  constructor() {
    super(
      'Pike13 write operations are disabled. ' +
        'Set PIKE13_WRITE_ENABLED=1 to enable them.',
    );
    this.name = 'Pike13WriteDisabledError';
  }
}

/**
 * Thrown when the Pike13 API returns a non-2xx HTTP response (other than 404).
 *
 * OQ-003: Error response body shape is unconfirmed. The `detail` field may
 * not be present or may use a different key (e.g., `message`, `error`).
 */
export class Pike13ApiError extends Error {
  readonly statusCode?: number;
  readonly method: string;

  constructor(message: string, method: string, statusCode?: number, cause?: unknown) {
    super(message);
    this.name = 'Pike13ApiError';
    this.method = method;
    this.statusCode = statusCode;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when a person lookup targets a person ID that does not exist
 * (HTTP 404 from the Pike13 API).
 */
export class Pike13PersonNotFoundError extends Error {
  readonly personId: number;

  constructor(personId: number, method: string, cause?: unknown) {
    super(`Pike13 person not found: ${personId} (method: ${method})`);
    this.name = 'Pike13PersonNotFoundError';
    this.personId = personId;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A single person record from the Pike13 API.
 *
 * OQ-004: The exact fields returned are unconfirmed. This interface captures
 * the fields most likely to be available. Extend once the real API shape is
 * confirmed; the interface is designed to accept additional optional fields
 * without breaking existing callers.
 */
export interface Pike13Person {
  /** Unique person identifier assigned by Pike13. */
  id: number;
  /** First name. */
  first_name: string;
  /** Last name. */
  last_name: string;
  /** Primary email address. */
  email: string;
  /**
   * Custom field values, keyed by field ID or name.
   * OQ-004: Shape is unconfirmed — may be an array of {id, value} objects
   * or a flat key→value map. Represented as a flexible record for now.
   */
  custom_fields?: Record<string, unknown>;
}

/**
 * A paginated page of people from the Pike13 API.
 *
 * OQ-001: Pagination style (cursor vs. page-number vs. offset) is unconfirmed.
 * This type assumes cursor-based pagination. See the module-level OQ-001 comment.
 */
export interface Pike13PeoplePage {
  /** The people returned on this page. */
  people: Pike13Person[];
  /**
   * Opaque cursor for the next page, or null when this is the last page.
   * OQ-001: May need to change to a page number or offset once confirmed.
   */
  nextCursor: string | null;
}

// ---------------------------------------------------------------------------
// Pike13ApiClient interface
// ---------------------------------------------------------------------------

/**
 * Abstraction over Pike13 REST API operations needed by this application.
 *
 * Implementations:
 *  - Pike13ApiClientImpl  — real, uses fetch + Bearer token auth
 *  - FakePike13ApiClient  — test double in tests/server/helpers/
 */
export interface Pike13ApiClient {
  /**
   * List people from Pike13, one page at a time.
   *
   * Pass `cursor` from the previous page's `nextCursor` to retrieve the
   * next page. Omit (or pass undefined) for the first page.
   *
   * Does NOT require PIKE13_WRITE_ENABLED.
   *
   * OQ-001: Pagination semantics will need revision once the real API is confirmed.
   *
   * @throws Pike13ApiError on non-2xx API responses.
   */
  listPeople(cursor?: string): Promise<Pike13PeoplePage>;

  /**
   * Retrieve a single person by their Pike13 person ID.
   *
   * Does NOT require PIKE13_WRITE_ENABLED.
   *
   * @throws Pike13PersonNotFoundError if the person ID does not exist (404).
   * @throws Pike13ApiError on other non-2xx API responses.
   */
  getPerson(personId: number): Promise<Pike13Person>;

  /**
   * Update a custom field on a person.
   *
   * Requires PIKE13_WRITE_ENABLED=1.
   *
   * OQ-002: Endpoint path and request body shape are unconfirmed.
   *
   * @throws Pike13WriteDisabledError if PIKE13_WRITE_ENABLED is not "1".
   * @throws Pike13PersonNotFoundError if the person ID does not exist (404).
   * @throws Pike13ApiError on other non-2xx API responses.
   */
  updateCustomField(personId: number, fieldId: string, value: string): Promise<void>;
}

// ---------------------------------------------------------------------------
// Pike13ApiClientImpl — real implementation
// ---------------------------------------------------------------------------

/**
 * Real implementation of Pike13ApiClient using fetch + Pike13 Bearer token.
 *
 * Authentication: the client lazily exchanges PIKE13_CLIENT_ID +
 * PIKE13_CLIENT_SECRET for a bearer token via POST /oauth/token
 * (client_credentials grant) on first use, and caches it in memory. On a
 * 401 from any API call, the cached token is cleared and the request is
 * retried once so that mid-lifetime rotations are handled automatically.
 *
 * PIKE13_ACCESS_TOKEN, if set, short-circuits the exchange and is used
 * as-is — useful for testing or when the operator wants to pin a
 * specific token.
 *
 * Missing credentials do NOT prevent app startup. Errors are deferred to
 * the first method call.
 *
 * OQ-001: List pagination and OQ-002: custom-field endpoint shape are both
 * unconfirmed — see module-level comments.
 */
export class Pike13ApiClientImpl implements Pike13ApiClient {
  private readonly staticAccessToken: string | null;
  private readonly clientId: string | null;
  private readonly clientSecret: string | null;
  private readonly apiUrl: string;
  private readonly oauthTokenUrl: string;
  private cachedAccessToken: string | null = null;

  constructor(opts: {
    accessToken?: string | null;
    clientId?: string | null;
    clientSecret?: string | null;
    apiUrl?: string;
    oauthTokenUrl?: string;
  } = {}) {
    this.staticAccessToken = opts.accessToken?.trim() || null;
    this.clientId = opts.clientId?.trim() || null;
    this.clientSecret = opts.clientSecret?.trim() || null;
    this.apiUrl = opts.apiUrl ?? resolvePike13ApiUrl();
    this.oauthTokenUrl = opts.oauthTokenUrl ?? deriveOauthTokenUrl(this.apiUrl);
  }

  // ---------------------------------------------------------------------------
  // Guard helpers
  // ---------------------------------------------------------------------------

  /**
   * Throws Pike13WriteDisabledError if PIKE13_WRITE_ENABLED is not "1".
   * Must be called as the first step of every write method.
   */
  private assertWriteEnabled(methodName: string): void {
    const flag = process.env.PIKE13_WRITE_ENABLED;
    if (flag !== '1') {
      logger.error(
        { method: methodName, flag },
        '[pike13-api] Write operation attempted but PIKE13_WRITE_ENABLED is not "1".',
      );
      throw new Pike13WriteDisabledError();
    }
  }

  /**
   * Throws Pike13ApiError with a clear message if NO credentials are available —
   * neither a pinned access token nor a client_id/client_secret pair.
   */
  private assertCredentials(methodName: string): void {
    if (this.staticAccessToken) return;
    if (this.clientId && this.clientSecret) return;
    const msg =
      `[pike13-api] Cannot authenticate: neither PIKE13_ACCESS_TOKEN nor ` +
      `PIKE13_CLIENT_ID/PIKE13_CLIENT_SECRET are set. Cannot call ${methodName}.`;
    logger.error({ method: methodName }, msg);
    throw new Pike13ApiError(
      'Pike13 credentials are not configured',
      methodName,
      undefined,
    );
  }

  /**
   * Return a bearer token, lazily exchanging client_credentials on first use
   * and caching the result. A pinned PIKE13_ACCESS_TOKEN always wins.
   */
  private async getAccessToken(callerMethod: string): Promise<string> {
    if (this.staticAccessToken) return this.staticAccessToken;
    if (this.cachedAccessToken) return this.cachedAccessToken;
    return this.exchangeClientCredentials(callerMethod);
  }

  /**
   * POST client_credentials → Pike13 and cache the returned bearer token.
   * Called both on first use and on forced refresh after a 401.
   */
  private async exchangeClientCredentials(callerMethod: string): Promise<string> {
    if (!this.clientId || !this.clientSecret) {
      throw new Pike13ApiError(
        'Pike13 client credentials are not configured',
        callerMethod,
        undefined,
      );
    }

    logger.info(
      { url: this.oauthTokenUrl, callerMethod },
      '[pike13-api] Exchanging client_credentials for access token.',
    );

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    }).toString();

    let response: Response;
    try {
      response = await fetch(this.oauthTokenUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'Accept': 'application/json',
        },
        body,
      });
    } catch (networkErr) {
      logger.error(
        { url: this.oauthTokenUrl, err: networkErr },
        '[pike13-api] Network error during client_credentials exchange.',
      );
      throw new Pike13ApiError(
        `Network error exchanging Pike13 client_credentials: ${String(networkErr)}`,
        callerMethod,
        undefined,
        networkErr,
      );
    }

    if (!response.ok) {
      let errBody: unknown;
      try { errBody = await response.json(); } catch { errBody = null; }
      logger.error(
        { url: this.oauthTokenUrl, status: response.status, body: errBody },
        '[pike13-api] client_credentials exchange failed.',
      );
      throw new Pike13ApiError(
        `Pike13 client_credentials exchange returned ${response.status}`,
        callerMethod,
        response.status,
      );
    }

    const payload = (await response.json()) as { access_token?: string; token_type?: string };
    if (!payload.access_token) {
      throw new Pike13ApiError(
        'Pike13 /oauth/token response missing access_token',
        callerMethod,
        response.status,
      );
    }

    this.cachedAccessToken = payload.access_token;
    logger.info(
      { callerMethod, tokenLength: payload.access_token.length },
      '[pike13-api] client_credentials exchange succeeded.',
    );
    return payload.access_token;
  }

  /**
   * Build common request headers for the Pike13 API. Authorization is added
   * by the caller after a fresh token has been resolved.
   */
  private buildHeaders(token: string): Record<string, string> {
    return {
      'Content-Type': 'application/json',
      'Accept': 'application/json',
      'Authorization': `Bearer ${token}`,
    };
  }

  /**
   * Make an authenticated request to the Pike13 API.
   * Parses the response as JSON and throws typed errors on non-2xx status.
   *
   * @throws Pike13PersonNotFoundError on 404 (only when personId is provided)
   * @throws Pike13ApiError on other non-2xx responses or network errors
   */
  private async request<T>(
    method: string,
    path: string,
    callerMethod: string,
    options?: { body?: unknown; personId?: number },
  ): Promise<T> {
    const url = `${this.apiUrl}${path}`;

    const doFetch = async (token: string): Promise<Response> => {
      return fetch(url, {
        method,
        headers: this.buildHeaders(token),
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      });
    };

    let token = await this.getAccessToken(callerMethod);
    let response: Response;
    try {
      response = await doFetch(token);
    } catch (networkErr) {
      logger.error(
        { url, method, callerMethod, err: networkErr },
        '[pike13-api] Network error calling Pike13 API.',
      );
      throw new Pike13ApiError(
        `Network error calling Pike13 API (${callerMethod}): ${String(networkErr)}`,
        callerMethod,
        undefined,
        networkErr,
      );
    }

    // On 401, the cached token may be expired/revoked. Only retry when we
    // have client_credentials to mint a new one — a pinned static token
    // cannot be refreshed.
    if (response.status === 401 && !this.staticAccessToken && this.clientId && this.clientSecret) {
      logger.warn(
        { url, method, callerMethod },
        '[pike13-api] 401 from Pike13 — refreshing access token and retrying once.',
      );
      this.cachedAccessToken = null;
      try {
        token = await this.exchangeClientCredentials(callerMethod);
        response = await doFetch(token);
      } catch (retryErr) {
        logger.error(
          { url, method, callerMethod, err: retryErr },
          '[pike13-api] Retry after 401 failed.',
        );
        throw retryErr;
      }
    }

    if (response.status === 404) {
      let errBody: unknown;
      try { errBody = await response.json(); } catch { errBody = null; }
      logger.warn(
        { url, method, callerMethod, status: 404, body: errBody },
        '[pike13-api] Pike13 API returned 404.',
      );
      if (options?.personId !== undefined) {
        throw new Pike13PersonNotFoundError(options.personId, callerMethod);
      }
      throw new Pike13ApiError(
        `Pike13 API 404 (${callerMethod})`,
        callerMethod,
        404,
      );
    }

    if (!response.ok) {
      let errBody: unknown;
      try { errBody = await response.json(); } catch { errBody = null; }
      logger.error(
        { url, method, callerMethod, status: response.status, body: errBody },
        '[pike13-api] Pike13 API returned non-2xx status.',
      );
      throw new Pike13ApiError(
        `Pike13 API error ${response.status} (${callerMethod})`,
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
        '[pike13-api] Failed to parse Pike13 API response as JSON.',
      );
      throw new Pike13ApiError(
        `Failed to parse Pike13 API response (${callerMethod})`,
        callerMethod,
        response.status,
        parseErr,
      );
    }
  }

  // ---------------------------------------------------------------------------
  // Read methods
  // ---------------------------------------------------------------------------

  async listPeople(cursor?: string): Promise<Pike13PeoplePage> {
    this.assertCredentials('listPeople');

    // OQ-001: Query parameter name ("cursor") and page-size parameter name
    // ("per_page") are assumed — verify against real API docs.
    const params = new URLSearchParams({ per_page: '100' });
    if (cursor) {
      params.set('cursor', cursor);
    }

    logger.info(
      { cursor, apiUrl: this.apiUrl },
      '[pike13-api] listPeople: fetching page.',
    );

    // OQ-001: Response shape { people: [...], next_cursor: string | null }
    // is assumed — verify against real API docs.
    const result = await this.request<{
      people?: Pike13Person[];
      next_cursor?: string | null;
    }>('GET', `/people?${params.toString()}`, 'listPeople');

    const people = result.people ?? [];
    const nextCursor = result.next_cursor ?? null;

    logger.info(
      { count: people.length, hasMore: nextCursor !== null },
      '[pike13-api] listPeople: page received.',
    );

    return { people, nextCursor };
  }

  async getPerson(personId: number): Promise<Pike13Person> {
    this.assertCredentials('getPerson');

    logger.info(
      { personId },
      '[pike13-api] getPerson: fetching person.',
    );

    // OQ-004: Response may be wrapped in { person: { ... } } or returned
    // directly as the object — both shapes are tried below.
    const result = await this.request<{ person?: Pike13Person } | Pike13Person>(
      'GET',
      `/people/${personId}`,
      'getPerson',
      { personId },
    );

    // Unwrap { person: { ... } } if present; otherwise treat as direct object.
    const person = (result as { person?: Pike13Person }).person ?? (result as Pike13Person);

    logger.info(
      { personId, email: person.email },
      '[pike13-api] getPerson: person retrieved.',
    );

    return person;
  }

  // ---------------------------------------------------------------------------
  // Write methods
  // ---------------------------------------------------------------------------

  async updateCustomField(personId: number, fieldId: string, value: string): Promise<void> {
    this.assertWriteEnabled('updateCustomField');
    this.assertCredentials('updateCustomField');

    logger.info(
      { personId, fieldId },
      '[pike13-api] updateCustomField: updating field.',
    );

    // OQ-002: Endpoint path and body shape are assumed — verify against real
    // Pike13 API documentation. Common patterns:
    //   PATCH /people/<id>/custom_fields/<fieldId>  body: { value: "..." }
    //   PUT   /people/<id>/custom_fields            body: { field_id: "...", value: "..." }
    await this.request<void>(
      'PATCH',
      `/people/${personId}/custom_fields/${fieldId}`,
      'updateCustomField',
      {
        body: { value },
        personId,
      },
    );

    logger.info(
      { personId, fieldId },
      '[pike13-api] updateCustomField: field updated.',
    );
  }
}
