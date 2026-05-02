/**
 * Tests for the two new fields added to GET /api/admin/users in sprint 025 T003:
 *
 *   llmProxyEnabled  — true iff the user has at least one active LlmProxyToken
 *                      (expires_at > now AND revoked_at IS NULL).
 *   oauthClientCount — count of non-disabled OAuthClient rows created by the user
 *                      (disabled_at IS NULL).
 *
 * Each describe block covers one field independently, plus a combined check.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../../../server/src/app.js';
import { prisma } from '../../../../server/src/services/prisma.js';
import { makeUser } from '../../helpers/factories.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function wipe() {
  await (prisma as any).oAuthAccessToken.deleteMany();
  await (prisma as any).oAuthAuthorizationCode.deleteMany();
  await (prisma as any).oAuthRefreshToken.deleteMany();
  await (prisma as any).oAuthConsent.deleteMany();
  await (prisma as any).oAuthClient.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

beforeEach(wipe);
afterEach(wipe);

async function adminAgent() {
  const user = await makeUser({ role: 'admin', primary_email: 'testadmin@example.com' });
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email: 'testadmin@example.com', role: 'admin' });
  return { agent, adminUser: user };
}

/** Create an LLM proxy token row directly (bypasses service-layer to control exact dates). */
async function seedLlmToken(
  userId: number,
  opts: { expiresAt: Date; revokedAt?: Date | null } = { expiresAt: new Date(Date.now() + 86400_000) },
) {
  return (prisma as any).llmProxyToken.create({
    data: {
      user_id: userId,
      token_hash: `hash_${Math.random().toString(36).slice(2)}`,
      token_plaintext: `llmp_test_${Math.random().toString(36).slice(2)}`,
      expires_at: opts.expiresAt,
      revoked_at: opts.revokedAt ?? null,
      token_limit: 1_000_000,
    },
  });
}

// ---------------------------------------------------------------------------
// llmProxyEnabled
// ---------------------------------------------------------------------------

describe('GET /api/admin/users — llmProxyEnabled', () => {
  it('is false for a user with no LLM proxy tokens', async () => {
    const { agent } = await adminAgent();
    const target = await makeUser({ primary_email: 'notoken@example.com', role: 'student' });

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.llmProxyEnabled).toBe(false);
  });

  it('is true for a user with an active (non-expired, non-revoked) token', async () => {
    const { agent } = await adminAgent();
    const target = await makeUser({ primary_email: 'activetoken@example.com', role: 'student' });

    await seedLlmToken(target.id, { expiresAt: new Date(Date.now() + 7 * 86400_000) });

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.llmProxyEnabled).toBe(true);
  });

  it('is false for a user whose token is expired', async () => {
    const { agent } = await adminAgent();
    const target = await makeUser({ primary_email: 'expiredtoken@example.com', role: 'student' });

    // expires_at in the past
    await seedLlmToken(target.id, { expiresAt: new Date(Date.now() - 86400_000) });

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.llmProxyEnabled).toBe(false);
  });

  it('is false for a user whose token is revoked', async () => {
    const { agent } = await adminAgent();
    const target = await makeUser({ primary_email: 'revokedtoken@example.com', role: 'student' });

    // revoked_at set (non-null)
    await seedLlmToken(target.id, {
      expiresAt: new Date(Date.now() + 7 * 86400_000),
      revokedAt: new Date(Date.now() - 3600_000),
    });

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.llmProxyEnabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// oauthClientCount
// ---------------------------------------------------------------------------

describe('GET /api/admin/users — oauthClientCount', () => {
  it('is 0 for a user with no OAuth clients', async () => {
    const { agent } = await adminAgent();
    const target = await makeUser({ primary_email: 'noclients@example.com', role: 'student' });

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.oauthClientCount).toBe(0);
  });

  it('is 1 for a user with one active OAuth client', async () => {
    const { agent } = await adminAgent();
    const target = await makeUser({ primary_email: 'oneclient@example.com', role: 'student' });

    await registry.oauthClients.create(
      { name: 'My App', redirect_uris: [], allowed_scopes: [] },
      target.id,
    );

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.oauthClientCount).toBe(1);
  });

  it('is 2 for a user with two active OAuth clients', async () => {
    const { agent } = await adminAgent();
    const target = await makeUser({ primary_email: 'twoclients@example.com', role: 'student' });

    await registry.oauthClients.create(
      { name: 'App One', redirect_uris: [], allowed_scopes: [] },
      target.id,
    );
    await registry.oauthClients.create(
      { name: 'App Two', redirect_uris: [], allowed_scopes: [] },
      target.id,
    );

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.oauthClientCount).toBe(2);
  });

  it('does not count a disabled OAuth client', async () => {
    const { agent } = await adminAgent();
    const target = await makeUser({ primary_email: 'disabledclient@example.com', role: 'student' });

    // Create one active and one disabled client
    await registry.oauthClients.create(
      { name: 'Active App', redirect_uris: [], allowed_scopes: [] },
      target.id,
    );
    const { client: disabledClient } = await registry.oauthClients.create(
      { name: 'Disabled App', redirect_uris: [], allowed_scopes: [] },
      target.id,
    );
    // Soft-disable the second client
    await registry.oauthClients.disable(disabledClient.id, target.id);

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    // Only the active client is counted
    expect(found.oauthClientCount).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Both fields present together
// ---------------------------------------------------------------------------

describe('GET /api/admin/users — both new fields present', () => {
  it('both llmProxyEnabled and oauthClientCount appear on every user row', async () => {
    const { agent } = await adminAgent();
    const target = await makeUser({ primary_email: 'bothfields@example.com', role: 'student' });

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    for (const user of res.body) {
      expect(user).toHaveProperty('llmProxyEnabled');
      expect(typeof user.llmProxyEnabled).toBe('boolean');
      expect(user).toHaveProperty('oauthClientCount');
      expect(typeof user.oauthClientCount).toBe('number');
    }

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found.llmProxyEnabled).toBe(false);
    expect(found.oauthClientCount).toBe(0);
  });

  it('correctly reports both fields when a user has an active token and two clients', async () => {
    const { agent } = await adminAgent();
    const target = await makeUser({ primary_email: 'both-populated@example.com', role: 'student' });

    await seedLlmToken(target.id, { expiresAt: new Date(Date.now() + 7 * 86400_000) });
    await registry.oauthClients.create(
      { name: 'Client A', redirect_uris: [], allowed_scopes: [] },
      target.id,
    );
    await registry.oauthClients.create(
      { name: 'Client B', redirect_uris: [], allowed_scopes: [] },
      target.id,
    );

    const res = await agent.get('/api/admin/users');
    expect(res.status).toBe(200);

    const found = res.body.find((u: any) => u.id === target.id);
    expect(found).toBeDefined();
    expect(found.llmProxyEnabled).toBe(true);
    expect(found.oauthClientCount).toBe(2);
  });
});
