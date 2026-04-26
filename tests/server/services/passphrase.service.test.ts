/**
 * Integration tests for PassphraseService (Sprint 015 T003).
 *
 * Uses a real SQLite database via the shared Prisma client. All tests go
 * through the service layer so they exercise the full create/revoke/query
 * lifecycle including audit events.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { prisma } from '../../../server/src/services/prisma.js';
import { PassphraseService } from '../../../server/src/services/passphrase.service.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { ValidationError } from '../../../server/src/errors.js';
import { makeUser, makeGroup, makeCohort } from '../helpers/factories.js';

const audit = new AuditService();
const service = new PassphraseService(prisma, audit);

// ---------------------------------------------------------------------------
// DB teardown
// ---------------------------------------------------------------------------

async function resetDb() {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

beforeEach(resetDb);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hoursFromNow(h: number): Date {
  return new Date(Date.now() + h * 3_600_000);
}

function hoursAgo(h: number): Date {
  return new Date(Date.now() - h * 3_600_000);
}

// ---------------------------------------------------------------------------
// create — no explicit plaintext
// ---------------------------------------------------------------------------

describe('PassphraseService.create — generated passphrase', () => {
  it('persists a generated passphrase and returns a PassphraseRecord', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();

    const record = await service.create(
      { kind: 'group', id: group.id },
      { grantLlmProxy: false },
      actor.id,
    );

    expect(record.plaintext).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/); // 3-word hyphenated
    expect(record.scope).toBe('group');
    expect(record.scopeId).toBe(group.id);
    expect(record.grantLlmProxy).toBe(false);
    expect(record.expiresAt.getTime()).toBeGreaterThan(Date.now());
    // Expiry should be ~1 hour away (within a 10-second window for test timing).
    const diffMs = record.expiresAt.getTime() - Date.now();
    expect(diffMs).toBeGreaterThan(PassphraseService.TTL_MS - 10_000);
    expect(diffMs).toBeLessThanOrEqual(PassphraseService.TTL_MS + 1_000);
  });

  it('writes a create_signup_passphrase audit event with no plaintext in details', async () => {
    const actor = await makeUser({ role: 'admin' });
    const cohort = await makeCohort();

    await service.create(
      { kind: 'cohort', id: cohort.id },
      { grantLlmProxy: true },
      actor.id,
    );

    const event = await (prisma as any).auditEvent.findFirst({
      where: { action: 'create_signup_passphrase' },
    });
    expect(event).not.toBeNull();
    expect(event.actor_user_id).toBe(actor.id);
    // Details must NOT contain the plaintext.
    const details = event.details as Record<string, unknown>;
    expect(details).not.toHaveProperty('plaintext');
    expect(details).toMatchObject({
      scope: 'cohort',
      scopeId: cohort.id,
      grantLlmProxy: true,
    });
  });
});

// ---------------------------------------------------------------------------
// create — explicit plaintext
// ---------------------------------------------------------------------------

describe('PassphraseService.create — explicit plaintext', () => {
  it('stores the exact provided phrase (trimmed, lowercased)', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();

    const record = await service.create(
      { kind: 'group', id: group.id },
      { plaintext: '  Maple-Frog-River  ', grantLlmProxy: false },
      actor.id,
    );

    expect(record.plaintext).toBe('maple-frog-river');
  });

  it('throws ValidationError for a malformed plaintext', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();

    await expect(
      service.create(
        { kind: 'group', id: group.id },
        { plaintext: 'not_a_valid_passphrase!!!', grantLlmProxy: false },
        actor.id,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('throws ValidationError for a plaintext that is only one word', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();

    await expect(
      service.create(
        { kind: 'group', id: group.id },
        { plaintext: 'maple', grantLlmProxy: false },
        actor.id,
      ),
    ).rejects.toThrow(ValidationError);
  });
});

// ---------------------------------------------------------------------------
// create — rotation
// ---------------------------------------------------------------------------

describe('PassphraseService.create — rotation', () => {
  it('overwrites the existing passphrase and pushes expiry forward', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();

    const first = await service.create(
      { kind: 'group', id: group.id },
      { grantLlmProxy: false },
      actor.id,
    );

    // Short pause to ensure timestamps differ.
    await new Promise((r) => setTimeout(r, 5));

    const second = await service.create(
      { kind: 'group', id: group.id },
      { grantLlmProxy: true },
      actor.id,
    );

    expect(second.plaintext).not.toBe(first.plaintext);
    expect(second.grantLlmProxy).toBe(true);
    expect(second.expiresAt.getTime()).toBeGreaterThanOrEqual(first.expiresAt.getTime());

    // Only one active passphrase on the scope.
    const active = await service.getActive({ kind: 'group', id: group.id });
    expect(active?.plaintext).toBe(second.plaintext);
  });
});

// ---------------------------------------------------------------------------
// grantLlmProxy round-trip
// ---------------------------------------------------------------------------

describe('PassphraseService — grantLlmProxy round-trip', () => {
  it('stores and returns grantLlmProxy=true correctly', async () => {
    const actor = await makeUser({ role: 'admin' });
    const cohort = await makeCohort();

    const record = await service.create(
      { kind: 'cohort', id: cohort.id },
      { grantLlmProxy: true },
      actor.id,
    );

    expect(record.grantLlmProxy).toBe(true);

    const active = await service.getActive({ kind: 'cohort', id: cohort.id });
    expect(active?.grantLlmProxy).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// getActive
// ---------------------------------------------------------------------------

describe('PassphraseService.getActive', () => {
  it('returns null for a scope with no passphrase', async () => {
    const group = await makeGroup();
    const result = await service.getActive({ kind: 'group', id: group.id });
    expect(result).toBeNull();
  });

  it('returns the active record when a passphrase is present and not expired', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();
    await service.create({ kind: 'group', id: group.id }, { grantLlmProxy: false }, actor.id);

    const result = await service.getActive({ kind: 'group', id: group.id });
    expect(result).not.toBeNull();
    expect(result?.scope).toBe('group');
    expect(result?.scopeId).toBe(group.id);
  });

  it('returns null for an expired passphrase (expires_at in the past)', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();
    await service.create({ kind: 'group', id: group.id }, { grantLlmProxy: false }, actor.id);

    // Manually set expiry to the past.
    await (prisma as any).group.update({
      where: { id: group.id },
      data: { signup_passphrase_expires_at: hoursAgo(2) },
    });

    const result = await service.getActive({ kind: 'group', id: group.id });
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// revoke
// ---------------------------------------------------------------------------

describe('PassphraseService.revoke', () => {
  it('clears all passphrase fields and writes an audit event', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();
    await service.create({ kind: 'group', id: group.id }, { grantLlmProxy: false }, actor.id);

    await service.revoke({ kind: 'group', id: group.id }, actor.id);

    const active = await service.getActive({ kind: 'group', id: group.id });
    expect(active).toBeNull();

    const event = await (prisma as any).auditEvent.findFirst({
      where: { action: 'revoke_signup_passphrase' },
    });
    expect(event).not.toBeNull();
    expect(event.actor_user_id).toBe(actor.id);
  });

  it('is a no-op (no audit event) when no active passphrase exists', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();

    await service.revoke({ kind: 'group', id: group.id }, actor.id);

    const event = await (prisma as any).auditEvent.findFirst({
      where: { action: 'revoke_signup_passphrase' },
    });
    expect(event).toBeNull();
  });

  it('is also a no-op when the existing passphrase is already expired', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();
    await service.create({ kind: 'group', id: group.id }, { grantLlmProxy: false }, actor.id);

    // Expire it first.
    await (prisma as any).group.update({
      where: { id: group.id },
      data: { signup_passphrase_expires_at: hoursAgo(2) },
    });

    await service.revoke({ kind: 'group', id: group.id }, actor.id);

    const event = await (prisma as any).auditEvent.findFirst({
      where: { action: 'revoke_signup_passphrase' },
    });
    expect(event).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findBySignupValue
// ---------------------------------------------------------------------------

describe('PassphraseService.findBySignupValue', () => {
  it('returns scope info for a matching active cohort passphrase', async () => {
    const actor = await makeUser({ role: 'admin' });
    const cohort = await makeCohort();
    const record = await service.create(
      { kind: 'cohort', id: cohort.id },
      { grantLlmProxy: true },
      actor.id,
    );

    const match = await service.findBySignupValue(record.plaintext);
    expect(match).not.toBeNull();
    expect(match?.scope).toBe('cohort');
    expect(match?.id).toBe(cohort.id);
    expect(match?.grantLlmProxy).toBe(true);
  });

  it('returns scope info for a matching active group passphrase', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();
    const record = await service.create(
      { kind: 'group', id: group.id },
      { grantLlmProxy: false },
      actor.id,
    );

    const match = await service.findBySignupValue(record.plaintext);
    expect(match).not.toBeNull();
    expect(match?.scope).toBe('group');
    expect(match?.id).toBe(group.id);
    expect(match?.grantLlmProxy).toBe(false);
  });

  it('returns null for an unknown passphrase string', async () => {
    const match = await service.findBySignupValue('totally-unknown-phrase');
    expect(match).toBeNull();
  });

  it('returns null for an expired passphrase', async () => {
    const actor = await makeUser({ role: 'admin' });
    const cohort = await makeCohort();
    const record = await service.create(
      { kind: 'cohort', id: cohort.id },
      { grantLlmProxy: false },
      actor.id,
    );

    // Expire the passphrase.
    await (prisma as any).cohort.update({
      where: { id: cohort.id },
      data: { signup_passphrase_expires_at: hoursAgo(1) },
    });

    const match = await service.findBySignupValue(record.plaintext);
    expect(match).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// Collision detection
// ---------------------------------------------------------------------------

describe('PassphraseService — collision detection', () => {
  it('prevents two different scopes from having the same active passphrase', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();
    const cohort = await makeCohort();

    // Assign a known passphrase to the group.
    const known = 'maple-frog-river';
    await service.create(
      { kind: 'group', id: group.id },
      { plaintext: known, grantLlmProxy: false },
      actor.id,
    );

    // Attempting to assign the same passphrase to a cohort should throw.
    await expect(
      service.create(
        { kind: 'cohort', id: cohort.id },
        { plaintext: known, grantLlmProxy: false },
        actor.id,
      ),
    ).rejects.toThrow(ValidationError);
  });

  it('allows re-using a passphrase on the SAME scope (rotation)', async () => {
    const actor = await makeUser({ role: 'admin' });
    const group = await makeGroup();
    const known = 'maple-frog-river';

    await service.create(
      { kind: 'group', id: group.id },
      { plaintext: known, grantLlmProxy: false },
      actor.id,
    );

    // Rotating the same scope with the same phrase should succeed.
    const second = await service.create(
      { kind: 'group', id: group.id },
      { plaintext: known, grantLlmProxy: true },
      actor.id,
    );
    expect(second.plaintext).toBe(known);
  });
});
