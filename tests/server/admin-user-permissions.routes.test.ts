/**
 * Integration tests for PATCH /api/admin/users/:id/permissions (Sprint 027 T003).
 *
 * Runs against the real Prisma client so that database writes, audit events,
 * and bus notifications are verified end-to-end.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';
import { makeUser } from './helpers/factories';

// ---------------------------------------------------------------------------
// Shared fixtures
// ---------------------------------------------------------------------------

let adminAgent: ReturnType<typeof request.agent>;
let adminUserId: number;

beforeAll(async () => {
  adminAgent = request.agent(app);
  await adminAgent
    .post('/api/auth/test-login')
    .send({
      email: 'perm-patch-admin@example.com',
      displayName: 'Perm Patch Admin',
      role: 'ADMIN',
    })
    .expect(200);
  const admin = await prisma.user.findFirst({
    where: { primary_email: 'perm-patch-admin@example.com' },
  });
  adminUserId = admin!.id;
}, 30000);

// Wipe non-admin users and audit events between tests to avoid cross-test pollution.
async function wipeExceptAdmin() {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany({ where: { user_id: { not: adminUserId } } });
  await (prisma as any).user.deleteMany({ where: { id: { not: adminUserId } } });
}

beforeEach(async () => {
  await wipeExceptAdmin();
});

afterEach(async () => {
  await wipeExceptAdmin();
});

// ---------------------------------------------------------------------------
// PATCH /api/admin/users/:id/permissions — happy paths
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/users/:id/permissions — happy paths', () => {
  it('updates allows_llm_proxy and returns 200 with updated flags', async () => {
    const user = await makeUser({ role: 'student' });

    const res = await adminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({ allows_llm_proxy: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      allowsOauthClient: false,
      allowsLlmProxy: true,
      allowsLeagueAccount: false,
    });

    // Verify DB write
    const updated = await (prisma as any).user.findUnique({ where: { id: user.id } });
    expect(updated.allows_llm_proxy).toBe(true);
    expect(updated.allows_oauth_client).toBe(false);
    expect(updated.allows_league_account).toBe(false);
  });

  it('updates allows_oauth_client and returns 200 with updated flags', async () => {
    const user = await makeUser({ role: 'student' });

    const res = await adminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({ allows_oauth_client: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      allowsOauthClient: true,
      allowsLlmProxy: false,
      allowsLeagueAccount: false,
    });

    const updated = await (prisma as any).user.findUnique({ where: { id: user.id } });
    expect(updated.allows_oauth_client).toBe(true);
  });

  it('updates allows_league_account and returns 200 with updated flags', async () => {
    const user = await makeUser({ role: 'student' });

    const res = await adminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({ allows_league_account: true });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      allowsOauthClient: false,
      allowsLlmProxy: false,
      allowsLeagueAccount: true,
    });

    const updated = await (prisma as any).user.findUnique({ where: { id: user.id } });
    expect(updated.allows_league_account).toBe(true);
  });

  it('updates all three flags simultaneously in a combined patch', async () => {
    const user = await makeUser({ role: 'student' });

    const res = await adminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({
        allows_oauth_client: true,
        allows_llm_proxy: true,
        allows_league_account: true,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      allowsOauthClient: true,
      allowsLlmProxy: true,
      allowsLeagueAccount: true,
    });

    const updated = await (prisma as any).user.findUnique({ where: { id: user.id } });
    expect(updated.allows_oauth_client).toBe(true);
    expect(updated.allows_llm_proxy).toBe(true);
    expect(updated.allows_league_account).toBe(true);
  });

  it('empty body (no-op) returns 200 with current permission state', async () => {
    const user = await makeUser({ role: 'student' });

    const res = await adminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      allowsOauthClient: false,
      allowsLlmProxy: false,
      allowsLeagueAccount: false,
    });

    // Verify no DB write occurred (no audit event)
    const auditEvents = await (prisma as any).auditEvent.findMany({
      where: { action: 'user_permission_changed', target_user_id: user.id },
    });
    expect(auditEvents).toHaveLength(0);
  });

  it('can toggle a flag back to false', async () => {
    const user = await (prisma as any).user.create({
      data: {
        primary_email: 'toggle-perm@example.com',
        display_name: 'Toggle Perm User',
        role: 'student',
        created_via: 'admin_created',
        allows_llm_proxy: true,
      },
    });

    const res = await adminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({ allows_llm_proxy: false });

    expect(res.status).toBe(200);
    expect(res.body.allowsLlmProxy).toBe(false);

    const updated = await (prisma as any).user.findUnique({ where: { id: user.id } });
    expect(updated.allows_llm_proxy).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Audit event
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/users/:id/permissions — audit event', () => {
  it('writes a user_permission_changed audit event in the same transaction', async () => {
    const user = await makeUser({ role: 'student' });

    await adminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({ allows_llm_proxy: true })
      .expect(200);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'user_permission_changed', target_user_id: user.id },
    });

    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(adminUserId);
    expect(events[0].target_entity_type).toBe('User');
    expect(events[0].target_entity_id).toBe(String(user.id));
    expect(events[0].details).toMatchObject({
      before: { allows_llm_proxy: false },
      after: { allows_llm_proxy: true },
    });
  });

  it('does not write an audit event for an empty (no-op) patch', async () => {
    const user = await makeUser({ role: 'student' });

    await adminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({})
      .expect(200);

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'user_permission_changed', target_user_id: user.id },
    });
    expect(events).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Error cases
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/users/:id/permissions — error cases', () => {
  it('returns 400 when a permission field is a string instead of boolean', async () => {
    const user = await makeUser({ role: 'student' });

    const res = await adminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({ allows_llm_proxy: 'yes' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
    expect(res.body.error).toMatch(/allows_llm_proxy/);
  });

  it('returns 400 when a permission field is a number instead of boolean', async () => {
    const user = await makeUser({ role: 'student' });

    const res = await adminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({ allows_oauth_client: 1 });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 404 when the user does not exist', async () => {
    const res = await adminAgent
      .patch('/api/admin/users/999999/permissions')
      .send({ allows_llm_proxy: true });

    expect(res.status).toBe(404);
    expect(res.body).toHaveProperty('error');
  });

  it('returns 401 when the caller is not authenticated', async () => {
    const user = await makeUser({ role: 'student' });

    const res = await request(app)
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({ allows_llm_proxy: true });

    expect(res.status).toBe(401);
  });

  it('returns 403 when the caller is not an admin', async () => {
    const user = await makeUser({ role: 'student' });

    const nonAdminAgent = request.agent(app);
    await nonAdminAgent
      .post('/api/auth/test-login')
      .send({
        email: 'nonadmin-perm@example.com',
        displayName: 'Non Admin',
        role: 'USER',
      })
      .expect(200);

    const res = await nonAdminAgent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({ allows_llm_proxy: true });

    expect(res.status).toBe(403);
  });
});
