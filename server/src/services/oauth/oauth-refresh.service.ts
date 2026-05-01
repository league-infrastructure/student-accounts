/**
 * OAuthRefreshService — domain logic for OAuthRefreshToken rotation (Sprint 019).
 *
 * Responsibilities:
 *  - Mint a long-lived (30 day) refresh token for a user+client pair.
 *    Plaintext returned once; only the SHA-256 hash is persisted.
 *  - Rotate a refresh token atomically: validate, check reuse/revocation/expiry,
 *    mint new access + refresh tokens, mark old token replaced.
 *  - Reuse detection: if a replaced token is presented, revoke the entire chain
 *    (forward walk via replaced_by_id) and emit a security audit event.
 *
 * Security invariants:
 *  - Plaintext token is never stored. Only the SHA-256 hash is persisted.
 *  - replaced_by_id forms a linked list. Reuse detection walks forward until null
 *    then sets revoked_at on every row in the chain.
 *  - Disabled client check is performed on rotate (tokens issued before disable
 *    cannot be rotated).
 */

import { randomBytes, createHash } from 'node:crypto';
import { parseJsonArray, toJsonValue } from './oauth-client.service.js';
import { OAuthError } from './oauth-code.service.js';
import type { AuditService } from '../audit.service.js';
import type { OAuthTokenService } from './oauth-token.service.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TOKEN_BYTES = 32;
const REFRESH_EXPIRY_DAYS = 30;

// ---------------------------------------------------------------------------
// Hash helper
// ---------------------------------------------------------------------------

function hashToken(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function generatePlaintext(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OAuthRefreshService {
  constructor(
    private readonly prisma: any,
    private readonly audit: AuditService,
    private readonly oauthTokens: OAuthTokenService,
  ) {}

  // --------------------------------------------------------------------
  // mint — generate and persist a refresh token
  // --------------------------------------------------------------------

  async mint(args: {
    client_id: number;
    user_id: number;
    scopes: string[];
  }): Promise<{ token: string }> {
    const plaintext = generatePlaintext();
    const tokenHash = hashToken(plaintext);
    const expiresAt = new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 3600 * 1000);

    await this.prisma.$transaction(async (tx: any) => {
      await tx.oAuthRefreshToken.create({
        data: {
          token_hash: tokenHash,
          oauth_client_id: args.client_id,
          user_id: args.user_id,
          scopes: toJsonValue(args.scopes),
          expires_at: expiresAt,
        },
      });
      await this.audit.record(tx, {
        actor_user_id: args.user_id,
        action: 'oauth_refresh_minted',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(args.client_id),
        details: { oauth_client_id: args.client_id, scopes: args.scopes },
      });
    });

    return { token: plaintext };
  }

  // --------------------------------------------------------------------
  // rotate — validate + atomically rotate a refresh token
  // --------------------------------------------------------------------

  async rotate(args: { token: string }): Promise<{
    refresh_token: string;
    access_token: string;
    expires_in: number;
    scopes: string[];
  }> {
    const tokenHash = hashToken(args.token);

    // --- Validate outside the transaction first (read-only, safe) ---
    const row = await this.prisma.oAuthRefreshToken.findUnique({
      where: { token_hash: tokenHash },
      include: { oauth_client: { select: { id: true, client_id: true, disabled_at: true } } },
    });

    if (!row) {
      throw new OAuthError('invalid_grant', 'Refresh token not found');
    }

    // Check if client is disabled.
    if (row.oauth_client?.disabled_at !== null) {
      throw new OAuthError('invalid_client', 'OAuth client is disabled');
    }

    // Reuse detection: token has already been rotated (replaced_by_id is set).
    if (row.replaced_by_id !== null) {
      await this.revokeChain(row.id, row.oauth_client_id, row.user_id);
      throw new OAuthError('invalid_grant', 'Refresh token replay detected — chain revoked');
    }

    // Check revocation.
    if (row.revoked_at !== null) {
      throw new OAuthError('invalid_grant', 'Refresh token has been revoked');
    }

    // Check expiry.
    if (row.expires_at.getTime() <= Date.now()) {
      throw new OAuthError('invalid_grant', 'Refresh token expired');
    }

    const scopes = parseJsonArray(row.scopes);
    const clientId = row.oauth_client_id;
    const userId = row.user_id;

    // --- Atomically rotate: create new refresh token + mark old replaced ---
    const newPlaintext = generatePlaintext();
    const newHash = hashToken(newPlaintext);
    const newExpiresAt = new Date(Date.now() + REFRESH_EXPIRY_DAYS * 24 * 3600 * 1000);

    await this.prisma.$transaction(async (tx: any) => {
      // Create new refresh token.
      await tx.oAuthRefreshToken.create({
        data: {
          token_hash: newHash,
          oauth_client_id: clientId,
          user_id: userId,
          scopes: toJsonValue(scopes),
          expires_at: newExpiresAt,
        },
      });

      // Look up the newly created row to get its id.
      const newRow = await tx.oAuthRefreshToken.findUnique({
        where: { token_hash: newHash },
        select: { id: true },
      });

      // Mark old token as replaced + update last_used_at.
      await tx.oAuthRefreshToken.update({
        where: { id: row.id },
        data: {
          replaced_by_id: newRow!.id,
          last_used_at: new Date(),
        },
      });

      await this.audit.record(tx, {
        actor_user_id: userId,
        action: 'oauth_refresh_rotated',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(clientId),
        details: { oauth_client_id: clientId, scopes },
      });
    });

    // Mint access token for the same client+user+scopes.
    const accessResult = await this.oauthTokens.issueForUser({
      oauthClientId: clientId,
      clientId: row.oauth_client.client_id,
      userId: userId,
      scopes,
    });

    return {
      refresh_token: newPlaintext,
      access_token: accessResult.access_token,
      expires_in: accessResult.expires_in,
      scopes,
    };
  }

  // --------------------------------------------------------------------
  // revokeChain — walk replaced_by_id forward, revoke all nodes
  // --------------------------------------------------------------------

  private async revokeChain(
    startId: number,
    clientId: number,
    userId: number,
  ): Promise<void> {
    // Walk forward from startId through the replaced_by_id linked list.
    const chainIds: number[] = [];
    let currentId: number | null = startId;
    const visited = new Set<number>();

    while (currentId !== null && !visited.has(currentId)) {
      visited.add(currentId);
      chainIds.push(currentId);
      const node: { replaced_by_id: number | null } | null =
        await this.prisma.oAuthRefreshToken.findUnique({
          where: { id: currentId },
          select: { replaced_by_id: true },
        });
      currentId = node?.replaced_by_id ?? null;
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx: any) => {
      await tx.oAuthRefreshToken.updateMany({
        where: { id: { in: chainIds } },
        data: { revoked_at: now },
      });
      await this.audit.record(tx, {
        actor_user_id: userId,
        action: 'oauth_refresh_reuse_detected',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(clientId),
        details: {
          oauth_client_id: clientId,
          user_id: userId,
          chain_length: chainIds.length,
          severity: 'security',
        },
      });
    });
  }
}
