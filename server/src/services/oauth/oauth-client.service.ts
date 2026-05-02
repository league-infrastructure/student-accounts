/**
 * OAuthClientService — domain logic for the OAuthClient entity (Sprint 018).
 *
 * Responsibilities:
 *  - Create a new OAuth client: generate client_id + plaintext secret, hash
 *    the secret (SHA-256), persist the hash + metadata, return the plaintext
 *    exactly once.
 *  - Rotate secret: generate a new plaintext, replace the stored hash,
 *    return the new plaintext exactly once.
 *  - Disable a client (soft delete via disabled_at).
 *  - Look up a client by client_id.
 *  - Verify a client_id + secret pair via constant-time compare.
 *
 * Security invariants:
 *  - The plaintext secret is NEVER persisted. It is generated in memory,
 *    returned to the caller exactly once, and discarded.
 *  - verifySecret uses timingSafeEqual so the comparison time does not
 *    reveal partial matches. Only non-disabled clients pass.
 *
 * JSON column helpers:
 *  - redirect_uris and allowed_scopes are stored as Json (SQLite-compatible).
 *    parseJsonArray / toJsonValue helpers convert between string[] and the
 *    Prisma Json type. These are also exported for use by OAuthTokenService.
 */

import { randomBytes, createHash, timingSafeEqual } from 'node:crypto';

import { AppError, ForbiddenError } from '../../errors.js';
import type { AuditService } from '../audit.service.js';
import { ScopePolicy } from './scope-policy.js';
import { ClientCapPolicy } from './client-cap-policy.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const SECRET_BYTES = 32;
const SECRET_PREFIX = 'oacs_'; // "OAuth App Client Secret"

// ---------------------------------------------------------------------------
// JSON column helpers
// ---------------------------------------------------------------------------

/**
 * Parse a Json column value (string | unknown) into a string[].
 * Stored as a JSON array string in SQLite; already an array in Postgres.
 */
export function parseJsonArray(value: unknown): string[] {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) return parsed as string[];
    } catch {
      // fall through
    }
  }
  return [];
}

/**
 * Convert a string[] to the Json value Prisma expects.
 * Prisma with the SQLite adapter accepts a plain JS array as Json.
 */
export function toJsonValue(arr: string[]): unknown {
  return arr;
}

// ---------------------------------------------------------------------------
// Hash helpers
// ---------------------------------------------------------------------------

function hashSecret(plaintext: string): string {
  return createHash('sha256').update(plaintext).digest('hex');
}

function generatePlaintext(): string {
  return SECRET_PREFIX + randomBytes(SECRET_BYTES).toString('base64url');
}

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type CreateOAuthClientInput = {
  name: string;
  description?: string | null;
  redirect_uris: string[];
  allowed_scopes: string[];
};

export type OAuthClientRow = {
  id: number;
  client_id: string;
  client_secret_hash: string;
  name: string;
  description: string | null;
  redirect_uris: unknown;
  allowed_scopes: unknown;
  created_by: number | null;
  created_at: Date;
  updated_at: Date;
  disabled_at: Date | null;
};

export type SanitizedOAuthClient = Omit<OAuthClientRow, 'client_secret_hash'> & {
  redirect_uris: string[];
  allowed_scopes: string[];
};

export type CreateResult = {
  client: SanitizedOAuthClient;
  plaintextSecret: string;
};

/**
 * Actor context passed to ownership-aware methods.
 * actorRole === 'admin' grants full access; all other roles are filtered
 * to resources owned by actorUserId (created_by).
 */
export type ActorContext = {
  actorUserId: number;
  actorRole: string;
};

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class OAuthClientService {
  constructor(
    private readonly prisma: any,
    private readonly audit: AuditService,
  ) {}

  // --------------------------------------------------------------------
  // Create
  // --------------------------------------------------------------------

  async create(
    input: CreateOAuthClientInput,
    actorUserId: number,
    actor?: ActorContext,
  ): Promise<CreateResult> {
    // ------------------------------------------------------------------
    // Policy checks (cap first, then scope — see ticket 002 / 001).
    // ------------------------------------------------------------------
    if (actor) {
      // Count non-disabled clients owned by this user.
      const activeCount = await this.prisma.oAuthClient.count({
        where: { created_by: actorUserId, disabled_at: null },
      });

      try {
        ClientCapPolicy.assertUnderCap(actor.actorRole, activeCount);
      } catch (capErr) {
        // Audit the rejection outside of the create transaction (no client row exists).
        const cap = ClientCapPolicy.maxClientsFor(actor.actorRole);
        await this.prisma.$transaction(async (tx: any) => {
          await this.audit.record(tx, {
            actor_user_id: actorUserId,
            action: 'oauth_client_create_rejected_cap',
            details: {
              role: actor.actorRole,
              current_count: activeCount,
              cap,
            },
          });
        });
        throw capErr;
      }

      ScopePolicy.assertAllowed(actor.actorRole, input.allowed_scopes);
    }

    const plaintext = generatePlaintext();
    const secretHash = hashSecret(plaintext);
    // Use a random suffix for the client_id so it is opaque but readable.
    const clientId = 'client_' + randomBytes(12).toString('base64url');

    const row: OAuthClientRow = await this.prisma.$transaction(async (tx: any) => {
      const created = await tx.oAuthClient.create({
        data: {
          client_id: clientId,
          client_secret_hash: secretHash,
          name: input.name,
          description: input.description ?? null,
          redirect_uris: toJsonValue(input.redirect_uris),
          allowed_scopes: toJsonValue(input.allowed_scopes),
          created_by: actorUserId,
        },
      });
      await this.audit.record(tx, {
        actor_user_id: actorUserId,
        action: 'oauth_client_created',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(created.id),
        details: { client_id: clientId, name: input.name },
      });
      return created;
    });

    return { client: this.sanitize(row), plaintextSecret: plaintext };
  }

  // --------------------------------------------------------------------
  // Rotate secret
  // --------------------------------------------------------------------

  async rotateSecret(
    id: number,
    actorUserId: number,
    actor?: ActorContext,
  ): Promise<{ plaintextSecret: string }> {
    if (actor) {
      const existing = await this.prisma.oAuthClient.findUnique({ where: { id } });
      if (existing) this.enforceOwnership(existing, actor);
    }

    const plaintext = generatePlaintext();
    const secretHash = hashSecret(plaintext);

    await this.prisma.$transaction(async (tx: any) => {
      const updated = await tx.oAuthClient.update({
        where: { id },
        data: { client_secret_hash: secretHash },
      });
      await this.audit.record(tx, {
        actor_user_id: actorUserId,
        action: 'oauth_client_secret_rotated',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(id),
        details: { client_id: updated.client_id },
      });
    });

    return { plaintextSecret: plaintext };
  }

  // --------------------------------------------------------------------
  // Disable (soft delete) — kept for token-revocation semantics in tests
  // and for any future "suspend without deleting" admin tooling.
  // --------------------------------------------------------------------

  async disable(id: number, actorUserId: number, actor?: ActorContext): Promise<void> {
    if (actor) {
      const existing = await this.prisma.oAuthClient.findUnique({ where: { id } });
      if (existing) this.enforceOwnership(existing, actor);
    }

    const now = new Date();
    await this.prisma.$transaction(async (tx: any) => {
      const updated = await tx.oAuthClient.update({
        where: { id },
        data: { disabled_at: now },
      });
      await this.audit.record(tx, {
        actor_user_id: actorUserId,
        action: 'oauth_client_disabled',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(id),
        details: { client_id: updated.client_id, disabled_at: now.toISOString() },
      });
    });
  }

  // --------------------------------------------------------------------
  // Delete (hard delete) — what the user-facing DELETE endpoint calls.
  // FK cascades drop dependent tokens, codes, refresh tokens, consents.
  // --------------------------------------------------------------------

  async delete(id: number, actorUserId: number, actor?: ActorContext): Promise<void> {
    if (actor) {
      const existing = await this.prisma.oAuthClient.findUnique({ where: { id } });
      if (existing) this.enforceOwnership(existing, actor);
    }

    await this.prisma.$transaction(async (tx: any) => {
      const removed = await tx.oAuthClient.delete({ where: { id } });
      await this.audit.record(tx, {
        actor_user_id: actorUserId,
        action: 'oauth_client_deleted',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(id),
        details: { client_id: removed.client_id, name: removed.name },
      });
    });
  }

  // --------------------------------------------------------------------
  // Update (PATCH — name/description/redirect_uris/allowed_scopes)
  // --------------------------------------------------------------------

  async update(
    id: number,
    patch: Partial<Pick<CreateOAuthClientInput, 'name' | 'description' | 'redirect_uris' | 'allowed_scopes'>>,
    actorUserId: number,
    actor?: ActorContext,
  ): Promise<SanitizedOAuthClient> {
    if (actor) {
      const existing = await this.prisma.oAuthClient.findUnique({ where: { id } });
      if (existing) this.enforceOwnership(existing, actor);
      // Scope ceiling check — enforce on update when allowed_scopes is being patched.
      if (patch.allowed_scopes !== undefined) {
        ScopePolicy.assertAllowed(actor.actorRole, patch.allowed_scopes);
      }
    }

    const data: Record<string, unknown> = {};
    if (patch.name !== undefined) data.name = patch.name;
    if (patch.description !== undefined) data.description = patch.description;
    if (patch.redirect_uris !== undefined) data.redirect_uris = toJsonValue(patch.redirect_uris);
    if (patch.allowed_scopes !== undefined) data.allowed_scopes = toJsonValue(patch.allowed_scopes);

    const row: OAuthClientRow = await this.prisma.$transaction(async (tx: any) => {
      const updated = await tx.oAuthClient.update({ where: { id }, data });
      await this.audit.record(tx, {
        actor_user_id: actorUserId,
        action: 'oauth_client_updated',
        target_entity_type: 'OAuthClient',
        target_entity_id: String(id),
        details: { fields: Object.keys(data) },
      });
      return updated;
    });

    return this.sanitize(row);
  }

  // --------------------------------------------------------------------
  // Find
  // --------------------------------------------------------------------

  async findByClientId(clientId: string): Promise<OAuthClientRow | null> {
    return this.prisma.oAuthClient.findUnique({ where: { client_id: clientId } });
  }

  async findById(id: number): Promise<OAuthClientRow | null>;
  async findById(id: number, actor: ActorContext): Promise<OAuthClientRow | null>;
  async findById(id: number, actor?: ActorContext): Promise<OAuthClientRow | null> {
    const row = await this.prisma.oAuthClient.findUnique({ where: { id } });
    if (actor && row) {
      this.enforceOwnership(row, actor);
    }
    return row;
  }

  async list({ actorUserId, actorRole }: ActorContext): Promise<SanitizedOAuthClient[]> {
    const where = actorRole === 'admin' ? {} : { created_by: actorUserId };
    const rows: OAuthClientRow[] = await this.prisma.oAuthClient.findMany({
      where,
      orderBy: { created_at: 'desc' },
    });
    return rows.map((r) => this.sanitize(r));
  }

  // --------------------------------------------------------------------
  // Verify secret — constant-time compare; returns null on any failure.
  // --------------------------------------------------------------------

  async verifySecret(
    clientId: string,
    plaintextSecret: string,
  ): Promise<OAuthClientRow | null> {
    if (!plaintextSecret) return null;

    const row = await this.findByClientId(clientId);
    if (!row) return null;
    // Reject disabled clients.
    if (row.disabled_at !== null) return null;

    const expectedHash = hashSecret(plaintextSecret);
    const storedHash = row.client_secret_hash;

    // Constant-time compare on the hex-encoded hashes (same length always).
    try {
      const a = Buffer.from(expectedHash, 'hex');
      const b = Buffer.from(storedHash, 'hex');
      if (a.length !== b.length) return null;
      if (!timingSafeEqual(a, b)) return null;
    } catch {
      return null;
    }

    return row;
  }

  // --------------------------------------------------------------------
  // Internal helpers
  // --------------------------------------------------------------------

  /**
   * Throws ForbiddenError if the actor is not an admin and does not own the client.
   */
  private enforceOwnership(client: OAuthClientRow, actor: ActorContext): void {
    if (actor.actorRole === 'admin') return;
    if (client.created_by !== actor.actorUserId) {
      throw new ForbiddenError('You do not own this OAuth client');
    }
  }

  sanitize(row: OAuthClientRow): SanitizedOAuthClient {
    const { client_secret_hash: _hash, ...rest } = row;
    return {
      ...rest,
      redirect_uris: parseJsonArray(row.redirect_uris),
      allowed_scopes: parseJsonArray(row.allowed_scopes),
    };
  }
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

export class OAuthClientNotFoundError extends AppError {
  constructor(id: number | string) {
    super(`OAuthClient ${id} not found`, 404);
    this.name = 'OAuthClientNotFoundError';
  }
}
