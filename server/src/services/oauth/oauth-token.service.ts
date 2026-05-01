/**
 * OAuthTokenService — domain logic for OAuthAccessToken (Sprint 018).
 *
 * Responsibilities:
 *  - Issue an access token for a verified OAuthClient (client-credentials grant).
 *  - Validate an incoming bearer token (used by oauthBearer middleware).
 *  - Update last_used_at on successful validation.
 *
 * Security invariants:
 *  - The plaintext token is never persisted. Only the SHA-256 hash is stored.
 *  - Token lookup is done by hash — no timing leak on the plaintext.
 *  - Expiry/revocation/disabled-client checked on every validation.
 *
 * Token format: `oat_<base64url(randomBytes(32))>` — prefix aids identification.
 */

import { randomBytes, createHash } from 'node:crypto';

import { parseJsonArray, toJsonValue } from './oauth-client.service.js';
import type { AuditService } from '../audit.service.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 32;
const TOKEN_PREFIX = 'oat_'; // "OAuth Access Token"
const EXPIRY_SECONDS = 3600; // 1 hour

// ---------------------------------------------------------------------------
// Hash helper
// ---------------------------------------------------------------------------

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function generatePlaintext(): string {
  return TOKEN_PREFIX + randomBytes(TOKEN_BYTES).toString('base64url');
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type IssueTokenInput = {
  oauthClientId: number;
  /** client_id string — stored in audit log. */
  clientId: string;
  /** Scopes requested by the client (already intersected with allowed_scopes). */
  scopes: string[];
};

export type IssueTokenResult = {
  access_token: string;
  token_type: 'Bearer';
  expires_in: number;
  scope: string;
};

export type OAuthTokenValidation = {
  id: number;
  oauth_client_id: number;
  client_id: string;
  user_id: number | null;
  scopes: string[];
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OAuthTokenService {
  constructor(
    private readonly prisma: any,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------
  // Issue — client-credentials grant
  // --------------------------------------------------------------------

  async issue(input: IssueTokenInput): Promise<IssueTokenResult> {
    const plaintext = generatePlaintext();
    const tokenHash = hashToken(plaintext);
    const expiresAt = new Date(Date.now() + EXPIRY_SECONDS * 1000);

    await this.prisma.$transaction(async (tx: any) => {
      await tx.oAuthAccessToken.create({
        data: {
          oauth_client_id: input.oauthClientId,
          user_id: null,
          token_hash: tokenHash,
          scopes: toJsonValue(input.scopes),
          expires_at: expiresAt,
        },
      });
      await this.audit.record(tx, {
        actor_user_id: null,
        action: 'oauth_token_issued',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(input.oauthClientId),
        details: { oauth_client_id: input.oauthClientId, client_id: input.clientId, scopes: input.scopes },
      });
    });

    return {
      access_token: plaintext,
      token_type: 'Bearer',
      expires_in: EXPIRY_SECONDS,
      scope: input.scopes.join(' '),
    };
  }

  // --------------------------------------------------------------------
  // Validate — used by oauthBearer middleware
  // --------------------------------------------------------------------

  /**
   * Validate a raw bearer token. Returns the validation info on success.
   * Returns null if the token is invalid, expired, revoked, or the owning
   * client is disabled.
   */
  async validate(plaintext: string): Promise<OAuthTokenValidation | null> {
    if (!plaintext) return null;

    const hash = hashToken(plaintext);
    const row = await this.prisma.oAuthAccessToken.findUnique({
      where: { token_hash: hash },
      include: { oauth_client: { select: { id: true, client_id: true, disabled_at: true } } },
    });

    if (!row) return null;
    if (row.expires_at.getTime() <= Date.now()) return null;
    if (row.revoked_at !== null) return null;
    if (row.oauth_client?.disabled_at !== null) return null;

    return {
      id: row.id,
      oauth_client_id: row.oauth_client_id,
      client_id: row.oauth_client.client_id,
      user_id: row.user_id,
      scopes: parseJsonArray(row.scopes),
    };
  }

  // --------------------------------------------------------------------
  // Update last_used_at — best-effort, fire-and-forget
  // --------------------------------------------------------------------

  updateLastUsed(tokenId: number): void {
    this.prisma.oAuthAccessToken
      .update({ where: { id: tokenId }, data: { last_used_at: new Date() } })
      .catch(() => {
        // Best-effort; do not surface errors to the caller.
      });
  }
}
