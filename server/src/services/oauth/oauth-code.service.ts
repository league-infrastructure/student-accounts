/**
 * OAuthCodeService — domain logic for OAuthAuthorizationCode (Sprint 019).
 *
 * Responsibilities:
 *  - Mint a short-lived (10 min) authorization code for a user+client pair.
 *    Plaintext returned once; only the SHA-256 hash is persisted.
 *  - Consume a code atomically (transactional update with consumed_at IS NULL
 *    predicate) enforcing single-use, expiry, redirect_uri match, and PKCE S256.
 *
 * Security invariants:
 *  - Plaintext code is never stored. Only the SHA-256 hash is persisted.
 *  - PKCE method must be S256 (plain is rejected at mint time).
 *  - PKCE verification: SHA-256(verifier, base64url no-padding) === stored challenge.
 *  - Concurrent consume calls use a WHERE consumed_at IS NULL predicate inside
 *    a transaction — one wins, the other sees count=0 and throws invalid_grant.
 *  - redirect_uri is bound at mint time and re-verified at consume time.
 *
 * RFC 7636 Appendix B test vectors:
 *   verifier:   dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk
 *   challenge:  E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';
import { parseJsonArray, toJsonValue } from './oauth-client.service.js';
import type { AuditService } from '../audit.service.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const CODE_BYTES = 32;
const CODE_EXPIRY_SECONDS = 10 * 60; // 10 minutes

// ---------------------------------------------------------------------------
// Typed error — maps to OAuth-spec error names for the token endpoint
// ---------------------------------------------------------------------------

export class OAuthError extends Error {
  constructor(
    public readonly code: 'invalid_request' | 'invalid_grant' | 'invalid_client' | 'invalid_scope' | 'unsupported_grant_type',
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'OAuthError';
  }
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

/** SHA-256 → hex string (used for code_hash storage). */
function hashCode(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

/** SHA-256 → base64url (no-padding) — used for PKCE S256 verification. */
function sha256Base64url(input: string): string {
  return createHash('sha256').update(input).digest('base64url');
}

function generatePlaintext(): string {
  return randomBytes(CODE_BYTES).toString('base64url');
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type MintCodeInput = {
  client_id: number;
  user_id: number;
  redirect_uri: string;
  scopes: string[];
  code_challenge: string;
  code_challenge_method: 'S256';
};

export type MintCodeResult = {
  code: string; // plaintext — returned once, never stored
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OAuthCodeService {
  constructor(
    private readonly prisma: any,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------
  // mint — generate and persist an authorization code
  // --------------------------------------------------------------------

  async mint(input: MintCodeInput): Promise<MintCodeResult> {
    if (input.code_challenge_method !== 'S256') {
      throw new OAuthError('invalid_request', 'code_challenge_method must be S256');
    }
    if (!input.code_challenge) {
      throw new OAuthError('invalid_request', 'code_challenge is required');
    }

    const plaintext = generatePlaintext();
    const codeHash = hashCode(plaintext);
    const expiresAt = new Date(Date.now() + CODE_EXPIRY_SECONDS * 1000);

    await this.prisma.$transaction(async (tx: any) => {
      await tx.oAuthAuthorizationCode.create({
        data: {
          code_hash: codeHash,
          oauth_client_id: input.client_id,
          user_id: input.user_id,
          redirect_uri: input.redirect_uri,
          scopes: toJsonValue(input.scopes),
          code_challenge: input.code_challenge,
          code_challenge_method: input.code_challenge_method,
          expires_at: expiresAt,
        },
      });
      await this.audit.record(tx, {
        actor_user_id: input.user_id,
        action: 'oauth_code_issued',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(input.client_id),
        details: { oauth_client_id: input.client_id, scopes: input.scopes },
      });
    });

    return { code: plaintext };
  }

  // --------------------------------------------------------------------
  // consume — atomically validate and mark code used; returns the row
  // --------------------------------------------------------------------

  async consume(args: {
    code: string;
    redirect_uri: string;
    code_verifier: string;
  }): Promise<{
    id: number;
    oauth_client_id: number;
    user_id: number;
    scopes: string[];
    redirect_uri: string;
  }> {
    const { code, redirect_uri, code_verifier } = args;
    const codeHash = hashCode(code);

    // Perform the entire validation + consumption inside a single transaction.
    // The UPDATE with consumed_at IS NULL predicate is the single-use gate.
    const row = await this.prisma.$transaction(async (tx: any) => {
      // 1. Look up by hash.
      const found = await tx.oAuthAuthorizationCode.findUnique({
        where: { code_hash: codeHash },
      });
      if (!found) {
        throw new OAuthError('invalid_grant', 'Authorization code not found');
      }

      // 2. Check expiry.
      if (found.expires_at.getTime() <= Date.now()) {
        throw new OAuthError('invalid_grant', 'Authorization code expired');
      }

      // 3. Check single-use (consumed_at must be null).
      if (found.consumed_at !== null) {
        throw new OAuthError('invalid_grant', 'Authorization code already consumed');
      }

      // 4. Validate redirect_uri exact match.
      if (found.redirect_uri !== redirect_uri) {
        throw new OAuthError('invalid_grant', 'redirect_uri mismatch');
      }

      // 5. PKCE S256 verification: base64url(sha256(verifier)) === stored challenge.
      //    Constant-time compare to prevent timing attacks.
      const derivedChallenge = sha256Base64url(code_verifier);
      const storedChallenge = found.code_challenge;

      let pkceValid = false;
      try {
        pkceValid = timingSafeEqual(
          Buffer.from(derivedChallenge, 'utf8'),
          Buffer.from(storedChallenge, 'utf8'),
        );
      } catch {
        pkceValid = false;
      }
      if (!pkceValid) {
        throw new OAuthError('invalid_grant', 'PKCE code_verifier mismatch');
      }

      // 6. Atomically mark consumed: the WHERE includes consumed_at IS NULL
      //    so a concurrent request that passes the findUnique check still loses
      //    here (count will be 0 for the loser).
      const updated = await tx.oAuthAuthorizationCode.updateMany({
        where: { id: found.id, consumed_at: null },
        data: { consumed_at: new Date() },
      });
      if (updated.count === 0) {
        // Another concurrent request won the race.
        throw new OAuthError('invalid_grant', 'Authorization code already consumed (race)');
      }

      // 7. Audit.
      await this.audit.record(tx, {
        actor_user_id: found.user_id,
        action: 'oauth_code_consumed',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(found.oauth_client_id),
        details: { oauth_client_id: found.oauth_client_id, scopes: parseJsonArray(found.scopes) },
      });

      return found;
    });

    return {
      id: row.id,
      oauth_client_id: row.oauth_client_id,
      user_id: row.user_id,
      scopes: parseJsonArray(row.scopes),
      redirect_uri: row.redirect_uri,
    };
  }
}
