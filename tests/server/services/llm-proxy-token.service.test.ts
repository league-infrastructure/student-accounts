/**
 * Integration tests for LlmProxyTokenService (Sprint 013 T002).
 *
 * Uses a real SQLite database via the shared Prisma client. Tests exercise
 * grant / revoke / validate / recordUsage end-to-end so audit events and
 * transaction boundaries are verified directly.
 */
import { createHash } from 'node:crypto';
import { prisma } from '../../../server/src/services/prisma.js';
import {
  LlmProxyTokenService,
  LlmProxyTokenQuotaExceededError,
  LlmProxyTokenUnauthorizedError,
  TOKEN_PREFIX,
} from '../../../server/src/services/llm-proxy-token.service.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { ConflictError, NotFoundError } from '../../../server/src/errors.js';
import { makeUser } from '../helpers/factories.js';

const audit = new AuditService();
const service = new LlmProxyTokenService(prisma, audit);

function futureDate(daysAhead = 30): Date {
  return new Date(Date.now() + daysAhead * 24 * 3600 * 1000);
}

function pastDate(daysBehind = 1): Date {
  return new Date(Date.now() - daysBehind * 24 * 3600 * 1000);
}

async function resetDb() {
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

beforeEach(resetDb);

// ---------------------------------------------------------------------------
// grant
// ---------------------------------------------------------------------------

describe('LlmProxyTokenService.grant', () => {
  it('creates a row, returns a plaintext token with the llmp_ prefix', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });

    const result = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 100_000 },
      actor.id,
    );

    expect(result.token.startsWith(TOKEN_PREFIX)).toBe(true);
    expect(result.row.user_id).toBe(target.id);
    expect(result.row.granted_by).toBe(actor.id);
    expect(result.row.tokens_used).toBe(0);
    expect(result.row.request_count).toBe(0);
    expect(result.row.revoked_at).toBeNull();
    expect(result.row.token_limit).toBe(100_000);

    // Hash invariant: the persisted hash matches sha256(plaintext).
    const expectedHash = createHash('sha256')
      .update(result.token)
      .digest('hex');
    expect(result.row.token_hash).toBe(expectedHash);

    // Audit event written in the same transaction.
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'grant_llm_proxy_token' },
    });
    expect(events.length).toBe(1);
    expect(events[0].target_entity_type).toBe('LlmProxyToken');
    expect(events[0].target_entity_id).toBe(String(result.row.id));
    expect(events[0].target_user_id).toBe(target.id);
    expect(events[0].actor_user_id).toBe(actor.id);
    expect((events[0].details as any).scope).toBe('single');
    expect((events[0].details as any).tokenLimit).toBe(100_000);
  });

  it('includes scope metadata in the audit event when provided', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });
    await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      actor.id,
      { scope: 'cohort', scopeId: 42 },
    );
    const event = await (prisma as any).auditEvent.findFirst({
      where: { action: 'grant_llm_proxy_token' },
    });
    expect((event!.details as any).scope).toBe('cohort');
    expect((event!.details as any).scopeId).toBe(42);
  });

  it('throws ConflictError when an active token already exists', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });
    await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      actor.id,
    );
    await expect(
      service.grant(
        target.id,
        { expiresAt: futureDate(), tokenLimit: 2000 },
        actor.id,
      ),
    ).rejects.toThrow(ConflictError);
  });

  it('allows a new grant once the previous token is revoked', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });

    const first = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      actor.id,
    );
    await service.revoke(target.id, actor.id);
    const second = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 2000 },
      actor.id,
    );
    expect(second.row.id).not.toBe(first.row.id);
    expect(second.token).not.toBe(first.token);
  });

  it('allows a new grant once the previous token is expired', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });

    const first = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      actor.id,
    );
    // Flip expires_at into the past.
    await (prisma as any).llmProxyToken.update({
      where: { id: first.row.id },
      data: { expires_at: pastDate() },
    });

    const second = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 2000 },
      actor.id,
    );
    expect(second.row.id).not.toBe(first.row.id);
  });
});

// ---------------------------------------------------------------------------
// revoke
// ---------------------------------------------------------------------------

describe('LlmProxyTokenService.revoke', () => {
  it('sets revoked_at on the active token and emits revoke_llm_proxy_token', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });
    const { row } = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      actor.id,
    );

    await service.revoke(target.id, actor.id);

    const reloaded = await (prisma as any).llmProxyToken.findUnique({
      where: { id: row.id },
    });
    expect(reloaded.revoked_at).not.toBeNull();

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'revoke_llm_proxy_token' },
    });
    expect(events.length).toBe(1);
    expect(events[0].target_entity_id).toBe(String(row.id));
    expect(events[0].target_user_id).toBe(target.id);
  });

  it('throws NotFoundError when no active token exists', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });
    await expect(service.revoke(target.id, actor.id)).rejects.toThrow(
      NotFoundError,
    );
  });
});

// ---------------------------------------------------------------------------
// validate
// ---------------------------------------------------------------------------

describe('LlmProxyTokenService.validate', () => {
  it('returns the row for a fresh token', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });
    const { token, row } = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      actor.id,
    );
    const validated = await service.validate(token);
    expect(validated.id).toBe(row.id);
  });

  it('throws LlmProxyTokenUnauthorizedError for an unknown token', async () => {
    await expect(service.validate('llmp_garbage')).rejects.toThrow(
      LlmProxyTokenUnauthorizedError,
    );
  });

  it('throws LlmProxyTokenUnauthorizedError when the token is empty', async () => {
    await expect(service.validate('')).rejects.toThrow(
      LlmProxyTokenUnauthorizedError,
    );
  });

  it('throws LlmProxyTokenUnauthorizedError for a revoked token', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });
    const { token } = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      actor.id,
    );
    await service.revoke(target.id, actor.id);
    await expect(service.validate(token)).rejects.toThrow(
      LlmProxyTokenUnauthorizedError,
    );
  });

  it('throws LlmProxyTokenUnauthorizedError for an expired token', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });
    const { token, row } = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 1000 },
      actor.id,
    );
    await (prisma as any).llmProxyToken.update({
      where: { id: row.id },
      data: { expires_at: pastDate() },
    });
    await expect(service.validate(token)).rejects.toThrow(
      LlmProxyTokenUnauthorizedError,
    );
  });

  it('throws LlmProxyTokenQuotaExceededError when tokens_used >= token_limit', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });
    const { token, row } = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 100 },
      actor.id,
    );
    await (prisma as any).llmProxyToken.update({
      where: { id: row.id },
      data: { tokens_used: 100 },
    });
    await expect(service.validate(token)).rejects.toThrow(
      LlmProxyTokenQuotaExceededError,
    );
  });
});

// ---------------------------------------------------------------------------
// recordUsage
// ---------------------------------------------------------------------------

describe('LlmProxyTokenService.recordUsage', () => {
  it('atomically increments tokens_used and request_count', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });
    const { row } = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 1_000_000 },
      actor.id,
    );

    await service.recordUsage(row.id, 200, 300);
    await service.recordUsage(row.id, 50, 70);

    const reloaded = await (prisma as any).llmProxyToken.findUnique({
      where: { id: row.id },
    });
    expect(reloaded.tokens_used).toBe(200 + 300 + 50 + 70);
    expect(reloaded.request_count).toBe(2);
  });

  it('swallows errors and does not throw', async () => {
    // An unknown id surfaces a Prisma P2025 error, which recordUsage must
    // catch and log (best-effort accounting — see the service comment).
    await expect(
      service.recordUsage(9_999_999, 10, 20),
    ).resolves.toBeUndefined();
  });

  it('clamps negative inputs to zero', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });
    const { row } = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 1_000_000 },
      actor.id,
    );
    await service.recordUsage(row.id, -5, -10);
    const reloaded = await (prisma as any).llmProxyToken.findUnique({
      where: { id: row.id },
    });
    expect(reloaded.tokens_used).toBe(0);
    expect(reloaded.request_count).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// getActiveForUser
// ---------------------------------------------------------------------------

describe('LlmProxyTokenService.getActiveForUser', () => {
  it('returns null when no active token exists', async () => {
    const target = await makeUser({ role: 'student' });
    const active = await service.getActiveForUser(target.id);
    expect(active).toBeNull();
  });

  it('returns the active token and skips revoked / expired ones', async () => {
    const actor = await makeUser({ role: 'admin' });
    const target = await makeUser({ role: 'student' });

    // First token — revoke it.
    await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 100 },
      actor.id,
    );
    await service.revoke(target.id, actor.id);

    // Second token — active.
    const { row: activeRow } = await service.grant(
      target.id,
      { expiresAt: futureDate(), tokenLimit: 200 },
      actor.id,
    );

    const active = await service.getActiveForUser(target.id);
    expect(active?.id).toBe(activeRow.id);
  });
});
