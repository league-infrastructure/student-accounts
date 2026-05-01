/**
 * Integration tests for OAuthClientService (Sprint 018 T002).
 *
 * Runs against the real test SQLite DB. Mirrors the pattern used in
 * llm-proxy-token.service tests.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { OAuthClientService, parseJsonArray } from '../../../../server/src/services/oauth/oauth-client.service.js';
import { makeUser } from '../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

async function wipe() {
  await (prisma as any).oAuthAccessToken.deleteMany();
  await (prisma as any).oAuthClient.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

beforeEach(wipe);
afterEach(wipe);

function makeService() {
  const audit = new AuditService();
  return new OAuthClientService(prisma, audit);
}

// ---------------------------------------------------------------------------
// JSON array round-trip smoke test (ticket 001 optional smoke)
// ---------------------------------------------------------------------------

describe('parseJsonArray', () => {
  it('round-trips a string array via the Prisma Json column', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();
    const { client } = await svc.create(
      { name: 'JSON Test', redirect_uris: ['https://a.com', 'https://b.com'], allowed_scopes: ['users:read'] },
      actor.id,
    );
    expect(client.redirect_uris).toEqual(['https://a.com', 'https://b.com']);
    expect(client.allowed_scopes).toEqual(['users:read']);

    // Re-fetch raw to confirm the Json column was persisted correctly.
    const raw = await (prisma as any).oAuthClient.findUnique({ where: { id: client.id } });
    expect(parseJsonArray(raw.redirect_uris)).toEqual(['https://a.com', 'https://b.com']);
  });
});

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

describe('OAuthClientService.create', () => {
  it('returns a plaintext secret and a sanitized client row', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();

    const { client, plaintextSecret } = await svc.create(
      { name: 'My App', description: 'Test app', redirect_uris: [], allowed_scopes: ['users:read'] },
      actor.id,
    );

    expect(plaintextSecret).toMatch(/^oacs_/);
    expect(client.name).toBe('My App');
    expect(client.description).toBe('Test app');
    expect((client as any).client_secret_hash).toBeUndefined();
    expect(client.client_id).toBeTruthy();
    expect(client.disabled_at).toBeNull();
  });

  it('stores the hash, not the plaintext', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();
    const { client, plaintextSecret } = await svc.create(
      { name: 'HashTest', redirect_uris: [], allowed_scopes: [] },
      actor.id,
    );

    const raw = await (prisma as any).oAuthClient.findUnique({ where: { id: client.id } });
    expect(raw.client_secret_hash).toBeTruthy();
    expect(raw.client_secret_hash).not.toBe(plaintextSecret);
  });

  it('writes an oauth_client_created audit event', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();
    await svc.create({ name: 'AuditTest', redirect_uris: [], allowed_scopes: [] }, actor.id);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_created' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(actor.id);
  });
});

// ---------------------------------------------------------------------------
// Rotate secret
// ---------------------------------------------------------------------------

describe('OAuthClientService.rotateSecret', () => {
  it('replaces the hash and returns a new plaintext', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();
    const { client, plaintextSecret: original } = await svc.create(
      { name: 'RotateTest', redirect_uris: [], allowed_scopes: [] },
      actor.id,
    );

    const rawBefore = await (prisma as any).oAuthClient.findUnique({ where: { id: client.id } });
    const { plaintextSecret: rotated } = await svc.rotateSecret(client.id, actor.id);

    expect(rotated).not.toBe(original);
    const rawAfter = await (prisma as any).oAuthClient.findUnique({ where: { id: client.id } });
    expect(rawAfter.client_secret_hash).not.toBe(rawBefore.client_secret_hash);
  });

  it('writes an oauth_client_secret_rotated audit event', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();
    const { client } = await svc.create({ name: 'RotateAudit', redirect_uris: [], allowed_scopes: [] }, actor.id);
    await svc.rotateSecret(client.id, actor.id);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_secret_rotated' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(actor.id);
  });
});

// ---------------------------------------------------------------------------
// Disable
// ---------------------------------------------------------------------------

describe('OAuthClientService.disable', () => {
  it('sets disabled_at to a non-null date', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();
    const { client } = await svc.create({ name: 'DisableTest', redirect_uris: [], allowed_scopes: [] }, actor.id);

    await svc.disable(client.id, actor.id);

    const raw = await (prisma as any).oAuthClient.findUnique({ where: { id: client.id } });
    expect(raw.disabled_at).toBeTruthy();
  });

  it('writes an oauth_client_disabled audit event', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();
    const { client } = await svc.create({ name: 'DisableAudit', redirect_uris: [], allowed_scopes: [] }, actor.id);
    await svc.disable(client.id, actor.id);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_disabled' } });
    expect(events).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// verifySecret
// ---------------------------------------------------------------------------

describe('OAuthClientService.verifySecret', () => {
  it('returns the client when credentials are correct', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();
    const { client, plaintextSecret } = await svc.create(
      { name: 'VerifyOK', redirect_uris: [], allowed_scopes: ['users:read'] },
      actor.id,
    );

    const result = await svc.verifySecret(client.client_id, plaintextSecret);
    expect(result).not.toBeNull();
    expect(result!.id).toBe(client.id);
  });

  it('returns null for a wrong secret', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();
    const { client } = await svc.create({ name: 'VerifyWrong', redirect_uris: [], allowed_scopes: [] }, actor.id);

    const result = await svc.verifySecret(client.client_id, 'oacs_wrongsecret');
    expect(result).toBeNull();
  });

  it('returns null for an unknown client_id', async () => {
    const svc = makeService();
    const result = await svc.verifySecret('client_nonexistent', 'oacs_anything');
    expect(result).toBeNull();
  });

  it('returns null for a disabled client even with correct secret', async () => {
    const actor = await makeUser({ role: 'admin' });
    const svc = makeService();
    const { client, plaintextSecret } = await svc.create(
      { name: 'VerifyDisabled', redirect_uris: [], allowed_scopes: [] },
      actor.id,
    );
    await svc.disable(client.id, actor.id);

    const result = await svc.verifySecret(client.client_id, plaintextSecret);
    expect(result).toBeNull();
  });
});
