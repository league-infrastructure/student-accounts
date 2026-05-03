/**
 * Integration tests for OAuth client CRUD routes (Sprint 020 T002).
 *
 * Routes moved from /api/admin/oauth-clients → /api/oauth-clients.
 * Now accessible to all authenticated users; ownership-filtered for non-admins.
 *
 * GET    /api/oauth-clients
 * POST   /api/oauth-clients
 * PATCH  /api/oauth-clients/:id
 * POST   /api/oauth-clients/:id/rotate-secret
 * DELETE /api/oauth-clients/:id
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../../server/src/app.js';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeGroup, makeMembership, makeUser } from '../helpers/factories.js';

// ---------------------------------------------------------------------------
// Helpers
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

async function loginAs(email: string, role: 'student' | 'staff' | 'admin' = 'student') {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
}

async function asAdmin() {
  const user = await makeUser({ role: 'admin', primary_email: 'admin@test.com' });
  const agent = await loginAs('admin@test.com', 'admin');
  return { agent, user };
}

async function asStudent(email = 'student@test.com') {
  const user = await makeUser({ role: 'student', primary_email: email });
  const agent = await loginAs(email, 'student');
  return { agent, user };
}

async function asStaff(email = 'staff@test.com') {
  const user = await makeUser({ role: 'staff', primary_email: email });
  const agent = await loginAs(email, 'staff');
  return { agent, user };
}

/**
 * Create a student in a group that grants allows_oauth_client=true.
 * Used wherever POST /api/oauth-clients needs to succeed for a student
 * with zero existing clients (Sprint 026 T003).
 */
async function asStudentWithOauthGroup(email = 'student@test.com') {
  const user = await makeUser({ role: 'student', primary_email: email });
  const group = await makeGroup({ allows_oauth_client: true });
  await makeMembership(group, user);
  const agent = await loginAs(email, 'student');
  return { agent, user, group };
}

/**
 * Create a staff user in a group that grants allows_oauth_client=true.
 * Used wherever POST /api/oauth-clients needs to succeed for staff
 * with zero existing clients (Sprint 026 T003).
 */
async function asStaffWithOauthGroup(email = 'staff@test.com') {
  const user = await makeUser({ role: 'staff', primary_email: email });
  const group = await makeGroup({ allows_oauth_client: true });
  await makeMembership(group, user);
  const agent = await loginAs(email, 'staff');
  return { agent, user, group };
}

// ---------------------------------------------------------------------------
// GET /api/oauth-clients — list (ownership-filtered)
// ---------------------------------------------------------------------------

describe('GET /api/oauth-clients', () => {
  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).get('/api/oauth-clients');
    expect(res.status).toBe(401);
  });

  it('student: lists only own clients', async () => {
    const { agent, user } = await asStudent('owner@test.com');
    const other = await makeUser({ role: 'student', primary_email: 'other@test.com' });

    await registry.oauthClients.create({ name: 'Mine', redirect_uris: [], allowed_scopes: [] }, user.id);
    await registry.oauthClients.create({ name: 'Theirs', redirect_uris: [], allowed_scopes: [] }, other.id);

    const res = await agent.get('/api/oauth-clients');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('Mine');
  });

  it('staff: lists only own clients', async () => {
    const { agent, user } = await asStaff('staffowner@test.com');
    const other = await makeUser({ role: 'student', primary_email: 'other2@test.com' });

    await registry.oauthClients.create({ name: 'StaffMine', redirect_uris: [], allowed_scopes: [] }, user.id);
    await registry.oauthClients.create({ name: 'StudentOther', redirect_uris: [], allowed_scopes: [] }, other.id);

    const res = await agent.get('/api/oauth-clients');
    expect(res.status).toBe(200);
    expect(res.body.length).toBe(1);
    expect(res.body[0].name).toBe('StaffMine');
  });

  it('admin: returns all clients regardless of owner', async () => {
    const { agent } = await asAdmin();
    const student = await makeUser({ role: 'student', primary_email: 'student2@test.com' });
    const adminUser = await makeUser({ role: 'admin', primary_email: 'admin2@test.com' });

    await registry.oauthClients.create({ name: 'StudentApp', redirect_uris: [], allowed_scopes: [] }, student.id);
    await registry.oauthClients.create({ name: 'AdminApp', redirect_uris: [], allowed_scopes: [] }, adminUser.id);

    const res = await agent.get('/api/oauth-clients');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThanOrEqual(2);
    const names = res.body.map((c: any) => c.name);
    expect(names).toContain('StudentApp');
    expect(names).toContain('AdminApp');
  });

  it('returns clients without client_secret_hash', async () => {
    const { agent, user } = await asStudent('nosecret@test.com');
    await registry.oauthClients.create({ name: 'TestApp', redirect_uris: [], allowed_scopes: ['users:read'] }, user.id);

    const res = await agent.get('/api/oauth-clients');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const client of res.body) {
      expect(client).not.toHaveProperty('client_secret_hash');
    }
  });
});

// ---------------------------------------------------------------------------
// POST /api/oauth-clients — create
// ---------------------------------------------------------------------------

describe('POST /api/oauth-clients', () => {
  it('creates a client and returns plaintext secret once', async () => {
    // Student must have a group with allows_oauth_client=true (Sprint 026 T003).
    const { agent } = await asStudentWithOauthGroup('creator@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'NewApp',
      description: 'Test',
      redirect_uris: ['https://example.com'],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('client');
    expect(res.body).toHaveProperty('client_secret');
    expect(res.body.client_secret).toMatch(/^oacs_/);
    expect(res.body.client).not.toHaveProperty('client_secret_hash');
    expect(res.body.client.name).toBe('NewApp');
  });

  it('returns 400 for missing name', async () => {
    const { agent } = await asStudent('bad@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      redirect_uris: [],
      allowed_scopes: [],
    });
    expect(res.status).toBe(400);
  });

  it('returns 400 if redirect_uris is not an array', async () => {
    const { agent } = await asStudent('bad2@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'Bad',
      redirect_uris: 'not-array',
      allowed_scopes: [],
    });
    expect(res.status).toBe(400);
  });

  it('writes an oauth_client_created audit event', async () => {
    // Student must have group permission to reach the create path (Sprint 026 T003).
    const { agent } = await asStudentWithOauthGroup('auditor@test.com');
    await agent.post('/api/oauth-clients').send({
      name: 'AuditApp',
      redirect_uris: [],
      allowed_scopes: [],
    });
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_created' } });
    expect(events.length).toBeGreaterThan(0);
  });

  it('returns 401 for unauthenticated request', async () => {
    const res = await request(app).post('/api/oauth-clients').send({
      name: 'Fail',
      redirect_uris: [],
      allowed_scopes: [],
    });
    expect(res.status).toBe(401);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/oauth-clients/:id — update (ownership-gated)
// ---------------------------------------------------------------------------

describe('PATCH /api/oauth-clients/:id', () => {
  it('owner: can update own client', async () => {
    const { agent, user } = await asStudent('owner-patch@test.com');
    const { client } = await registry.oauthClients.create({ name: 'Old', redirect_uris: [], allowed_scopes: [] }, user.id);

    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({ name: 'New' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('New');
    expect(res.body).not.toHaveProperty('client_secret_hash');
  });

  it('non-owner non-admin: gets 403', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'owner-real@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'Owned', redirect_uris: [], allowed_scopes: [] }, owner.id);

    const { agent } = await asStudent('intruder@test.com');
    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('admin: can update someone else\'s client', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'student-owned@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'StudentApp', redirect_uris: [], allowed_scopes: [] }, owner.id);

    const { agent } = await asAdmin();
    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({ name: 'AdminUpdated' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('AdminUpdated');
  });

  it('rejects non-array redirect_uris', async () => {
    const { agent, user } = await asStudent('patcher2@test.com');
    const { client } = await registry.oauthClients.create({ name: 'P', redirect_uris: [], allowed_scopes: [] }, user.id);

    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({ redirect_uris: 'invalid' });
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// POST /api/oauth-clients/:id/rotate-secret — rotate (ownership-gated)
// ---------------------------------------------------------------------------

describe('POST /api/oauth-clients/:id/rotate-secret', () => {
  it('owner: can rotate secret', async () => {
    const { agent, user } = await asStudent('rotator@test.com');
    const { client, plaintextSecret: original } = await registry.oauthClients.create(
      { name: 'RotateMe', redirect_uris: [], allowed_scopes: [] },
      user.id,
    );

    const res = await agent.post(`/api/oauth-clients/${client.id}/rotate-secret`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('client_secret');
    expect(res.body.client_secret).toMatch(/^oacs_/);
    expect(res.body.client_secret).not.toBe(original);
  });

  it('non-owner non-admin: gets 403', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'rotate-owner@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'RotateMe2', redirect_uris: [], allowed_scopes: [] }, owner.id);

    const { agent } = await asStudent('rotate-intruder@test.com');
    const res = await agent.post(`/api/oauth-clients/${client.id}/rotate-secret`);
    expect(res.status).toBe(403);
  });

  it('writes an oauth_client_secret_rotated audit event', async () => {
    const { agent, user } = await asStudent('rotator2@test.com');
    const { client } = await registry.oauthClients.create({ name: 'RA', redirect_uris: [], allowed_scopes: [] }, user.id);

    await agent.post(`/api/oauth-clients/${client.id}/rotate-secret`);
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'oauth_client_secret_rotated' } });
    expect(events.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// DELETE /api/oauth-clients/:id — hard delete (ownership-gated)
// ---------------------------------------------------------------------------

describe('DELETE /api/oauth-clients/:id', () => {
  it('owner: hard-deletes the row and returns 204', async () => {
    const { agent, user } = await asStudent('deleter@test.com');
    const { client } = await registry.oauthClients.create({ name: 'Del', redirect_uris: [], allowed_scopes: [] }, user.id);

    const res = await agent.delete(`/api/oauth-clients/${client.id}`);
    expect(res.status).toBe(204);

    const raw = await (prisma as any).oAuthClient.findUnique({ where: { id: client.id } });
    expect(raw).toBeNull();
  });

  it('non-owner non-admin: gets 403', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'delete-owner@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'Protected', redirect_uris: [], allowed_scopes: [] }, owner.id);

    const { agent } = await asStudent('delete-intruder@test.com');
    const res = await agent.delete(`/api/oauth-clients/${client.id}`);
    expect(res.status).toBe(403);
  });

  it('admin: can delete someone else\'s client', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'admin-delete-target@test.com' });
    const { client } = await registry.oauthClients.create({ name: 'AdminDel', redirect_uris: [], allowed_scopes: [] }, owner.id);

    const { agent } = await asAdmin();
    const res = await agent.delete(`/api/oauth-clients/${client.id}`);
    expect(res.status).toBe(204);
  });

  it('writes an oauth_client_deleted audit event', async () => {
    const { agent, user } = await asStudent('deleter2@test.com');
    const { client } = await registry.oauthClients.create({ name: 'DA', redirect_uris: [], allowed_scopes: [] }, user.id);

    await agent.delete(`/api/oauth-clients/${client.id}`);
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'oauth_client_deleted', target_entity_id: String(client.id) },
    });
    expect(events.length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Deprecated admin path — /api/admin/oauth-clients returns 404 (Sprint 023)
// ---------------------------------------------------------------------------

describe('Deprecated /api/admin/oauth-clients path', () => {
  it('returns 404 for deprecated admin path (authenticated admin)', async () => {
    const { agent } = await asAdmin();
    const res = await agent.get('/api/admin/oauth-clients');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Scope ceiling enforcement — POST /api/oauth-clients (Sprint 023 ticket 001)
// ---------------------------------------------------------------------------

describe('Scope ceiling — POST /api/oauth-clients', () => {
  it('student with profile only → 201', async () => {
    // Requires group permission (Sprint 026 T003).
    const { agent } = await asStudentWithOauthGroup('scope-student-ok@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'StudentApp',
      redirect_uris: [],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(201);
  });

  it('student with users:read → 403 (scope ceiling)', async () => {
    // Student has group permission but scope ceiling still applies.
    const { agent } = await asStudentWithOauthGroup('scope-student-bad@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'BadApp',
      redirect_uris: [],
      allowed_scopes: ['users:read'],
    });
    expect(res.status).toBe(403);
  });

  it('student with profile + users:read → 403 (scope ceiling)', async () => {
    // Student has group permission but scope ceiling still applies.
    const { agent } = await asStudentWithOauthGroup('scope-student-bad2@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'BadApp2',
      redirect_uris: [],
      allowed_scopes: ['profile', 'users:read'],
    });
    expect(res.status).toBe(403);
  });

  it('staff with profile + users:read → 201', async () => {
    // Requires group permission (Sprint 026 T003).
    const { agent } = await asStaffWithOauthGroup('scope-staff-ok@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'StaffApp',
      redirect_uris: [],
      allowed_scopes: ['profile', 'users:read'],
    });
    expect(res.status).toBe(201);
  });

  it('admin with profile + users:read → 201', async () => {
    const { agent } = await asAdmin();
    const res = await agent.post('/api/oauth-clients').send({
      name: 'AdminApp',
      redirect_uris: [],
      allowed_scopes: ['profile', 'users:read'],
    });
    expect(res.status).toBe(201);
  });
});

// ---------------------------------------------------------------------------
// Scope ceiling enforcement — PATCH /api/oauth-clients/:id (Sprint 023 ticket 001)
// ---------------------------------------------------------------------------

describe('Scope ceiling — PATCH /api/oauth-clients/:id', () => {
  it('student PATCH to add users:read → 403', async () => {
    const { agent, user } = await asStudent('scope-patch-bad@test.com');
    // Create via service (bypasses policy) so we have a client to patch.
    const { client } = await registry.oauthClients.create(
      { name: 'PatchTarget', redirect_uris: [], allowed_scopes: ['profile'] },
      user.id,
    );
    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({
      allowed_scopes: ['users:read'],
    });
    expect(res.status).toBe(403);
  });

  it('staff PATCH to set users:read → 200', async () => {
    const { agent, user } = await asStaff('scope-patch-staff@test.com');
    const { client } = await registry.oauthClients.create(
      { name: 'StaffPatch', redirect_uris: [], allowed_scopes: ['profile'] },
      user.id,
    );
    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({
      allowed_scopes: ['profile', 'users:read'],
    });
    expect(res.status).toBe(200);
  });

  it('student PATCH name only (no scope change) → 200', async () => {
    const { agent, user } = await asStudent('scope-patch-nameonly@test.com');
    const { client } = await registry.oauthClients.create(
      { name: 'NameOnly', redirect_uris: [], allowed_scopes: ['profile'] },
      user.id,
    );
    const res = await agent.patch(`/api/oauth-clients/${client.id}`).send({ name: 'Renamed' });
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Admin shared-pool invariant (Sprint 023 ticket 004)
// ---------------------------------------------------------------------------
// Any admin can view, update, rotate, and disable any other admin's client.
// Students and staff are still restricted to their own clients.
// ---------------------------------------------------------------------------

describe('admin shared-pool invariant', () => {
  async function asAdminB() {
    const user = await makeUser({ role: 'admin', primary_email: 'adminb@test.com' });
    const agent = await loginAs('adminb@test.com', 'admin');
    return { agent, user };
  }

  // Helper: admin A creates a client; we perform mutations as admin B.
  async function setupAdminBClient() {
    const adminB = await makeUser({ role: 'admin', primary_email: 'adminb@test.com' });
    const { client } = await registry.oauthClients.create(
      { name: 'AdminBApp', redirect_uris: [], allowed_scopes: [] },
      adminB.id,
    );
    // Admin A (the agent that will act on admin B's client).
    const adminA = await makeUser({ role: 'admin', primary_email: 'admina@test.com' });
    const agentA = await loginAs('admina@test.com', 'admin');
    return { agentA, adminA, adminB, client };
  }

  it('admin A can list and see admin B\'s client', async () => {
    const { agentA, adminB, client } = await setupAdminBClient();
    // Also create a client for adminA so the list has two entries.
    const adminAUser = await (prisma as any).user.findUnique({ where: { primary_email: 'admina@test.com' } });
    await registry.oauthClients.create({ name: 'AdminAApp', redirect_uris: [], allowed_scopes: [] }, adminAUser.id);

    const res = await agentA.get('/api/oauth-clients');
    expect(res.status).toBe(200);
    const ids = res.body.map((c: any) => c.id);
    expect(ids).toContain(client.id);
  });

  it('admin A can update admin B\'s client (rename)', async () => {
    const { agentA, client } = await setupAdminBClient();
    const res = await agentA.patch(`/api/oauth-clients/${client.id}`).send({ name: 'RenamedByA' });
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('RenamedByA');
  });

  it('audit event for admin A update records actor=admin A', async () => {
    const { agentA, adminA, client } = await setupAdminBClient();
    await agentA.patch(`/api/oauth-clients/${client.id}`).send({ name: 'AuditCheck' });
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'oauth_client_updated', target_entity_id: String(client.id) },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].actor_user_id).toBe(adminA.id);
  });

  it('admin A can rotate secret on admin B\'s client', async () => {
    const { agentA, client } = await setupAdminBClient();
    const res = await agentA.post(`/api/oauth-clients/${client.id}/rotate-secret`);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('client_secret');
    expect(res.body.client_secret).toMatch(/^oacs_/);
  });

  it('audit event for admin A rotate-secret records actor=admin A', async () => {
    const { agentA, adminA, client } = await setupAdminBClient();
    await agentA.post(`/api/oauth-clients/${client.id}/rotate-secret`);
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'oauth_client_secret_rotated', target_entity_id: String(client.id) },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].actor_user_id).toBe(adminA.id);
  });

  it('admin A can DELETE admin B\'s client (hard delete)', async () => {
    const { agentA, client } = await setupAdminBClient();
    const res = await agentA.delete(`/api/oauth-clients/${client.id}`);
    expect(res.status).toBe(204);
    const raw = await (prisma as any).oAuthClient.findUnique({ where: { id: client.id } });
    expect(raw).toBeNull();
  });

  it('audit event for admin A delete records actor=admin A', async () => {
    const { agentA, adminA, client } = await setupAdminBClient();
    await agentA.delete(`/api/oauth-clients/${client.id}`);
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'oauth_client_deleted', target_entity_id: String(client.id) },
    });
    expect(events.length).toBe(1);
    expect(events[0].actor_user_id).toBe(adminA.id);
  });

  it('student cannot update another student\'s client (403)', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'stu-owner@test.com' });
    const { client } = await registry.oauthClients.create(
      { name: 'StuOwned', redirect_uris: [], allowed_scopes: [] },
      owner.id,
    );
    const { agent: intruder } = await asStudent('stu-intruder@test.com');
    const res = await intruder.patch(`/api/oauth-clients/${client.id}`).send({ name: 'Hacked' });
    expect(res.status).toBe(403);
  });

  it('staff cannot update another user\'s client (403)', async () => {
    const owner = await makeUser({ role: 'student', primary_email: 'stu-owner2@test.com' });
    const { client } = await registry.oauthClients.create(
      { name: 'StuOwned2', redirect_uris: [], allowed_scopes: [] },
      owner.id,
    );
    const { agent: staffAgent } = await asStaff('staff-intruder@test.com');
    const res = await staffAgent.patch(`/api/oauth-clients/${client.id}`).send({ name: 'StaffHacked' });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Per-user cap enforcement — POST /api/oauth-clients (Sprint 023 ticket 002)
// ---------------------------------------------------------------------------

describe('Per-user cap — POST /api/oauth-clients', () => {
  it('student with 0 clients and group permission can create one → 201', async () => {
    // Requires group permission since activeCount=0 means not grandfathered (Sprint 026 T003).
    const { agent } = await asStudentWithOauthGroup('cap-student-first@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'FirstApp',
      redirect_uris: [],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(201);
  });

  it('student with 1 active client cannot create a second → 403', async () => {
    const { agent, user } = await asStudent('cap-student-second@test.com');
    // Create first client via service (bypasses cap for setup).
    await registry.oauthClients.create(
      { name: 'First', redirect_uris: [], allowed_scopes: ['profile'] },
      user.id,
    );
    // Second create via route should be rejected (cap, student is grandfathered so gate passes).
    const res = await agent.post('/api/oauth-clients').send({
      name: 'Second',
      redirect_uris: [],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(403);
  });

  it('student who disabled their one client and has group permission can create a new one → 201', async () => {
    // With only disabled clients, activeCount=0 and the student is not grandfathered.
    // Group permission is required to create (Sprint 026 T003).
    const { agent, user } = await asStudentWithOauthGroup('cap-student-disabled@test.com');
    const { client } = await registry.oauthClients.create(
      { name: 'DisabledApp', redirect_uris: [], allowed_scopes: ['profile'] },
      user.id,
    );
    // Disable the first client — should not count toward cap.
    await registry.oauthClients.disable(client.id, user.id);

    const res = await agent.post('/api/oauth-clients').send({
      name: 'NewApp',
      redirect_uris: [],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(201);
  });

  it('staff grandfathered by existing clients can always create another → 201', async () => {
    // Staff has 2 existing clients (activeCount>0), so the grandfather bypass applies;
    // no group permission needed (Sprint 026 T003). Staff has no per-user cap.
    const { agent, user } = await asStaff('cap-staff@test.com');
    // Pre-create two clients via service (bypasses policy).
    await registry.oauthClients.create({ name: 'S1', redirect_uris: [], allowed_scopes: [] }, user.id);
    await registry.oauthClients.create({ name: 'S2', redirect_uris: [], allowed_scopes: [] }, user.id);

    const res = await agent.post('/api/oauth-clients').send({
      name: 'S3',
      redirect_uris: [],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(201);
  });

  it('admin with multiple existing clients can always create another → 201', async () => {
    const { agent, user } = await asAdmin();
    await registry.oauthClients.create({ name: 'A1', redirect_uris: [], allowed_scopes: [] }, user.id);
    await registry.oauthClients.create({ name: 'A2', redirect_uris: [], allowed_scopes: [] }, user.id);

    const res = await agent.post('/api/oauth-clients').send({
      name: 'A3',
      redirect_uris: [],
      allowed_scopes: ['profile', 'users:read'],
    });
    expect(res.status).toBe(201);
  });

  it('cap rejection records an oauth_client_create_rejected_cap audit event', async () => {
    const { agent, user } = await asStudent('cap-audit@test.com');
    await registry.oauthClients.create(
      { name: 'First', redirect_uris: [], allowed_scopes: ['profile'] },
      user.id,
    );
    // This should be rejected and audited (cap; student is grandfathered so gate passes).
    await agent.post('/api/oauth-clients').send({
      name: 'Second',
      redirect_uris: [],
      allowed_scopes: ['profile'],
    });
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'oauth_client_create_rejected_cap' },
    });
    expect(events.length).toBeGreaterThan(0);
    expect(events[0].details.role).toBe('student');
    expect(events[0].details.cap).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Group permission gate — POST /api/oauth-clients (Sprint 026 ticket 003)
// ---------------------------------------------------------------------------

describe('Group permission gate — POST /api/oauth-clients', () => {
  it('student with no group and no existing clients → 403 (denied)', async () => {
    const { agent } = await asStudent('gate-denied@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'DeniedApp',
      redirect_uris: [],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/allowsOauthClient/);
  });

  it('student with no group and no existing clients: 403 message names missing permission', async () => {
    const { agent } = await asStudent('gate-message@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'NoPermApp',
      redirect_uris: [],
      allowed_scopes: [],
    });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain('allowsOauthClient');
  });

  it('student in an OAuth-client group → 201 (permitted)', async () => {
    const { agent } = await asStudentWithOauthGroup('gate-permitted@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'PermittedApp',
      redirect_uris: [],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(201);
  });

  it('staff with one existing non-disabled client but no group → 201 (grandfather bypass)', async () => {
    // Grandfather: activeCount > 0 bypasses the group permission gate.
    // Use staff (no per-user cap) so the test isolates the group gate, not the cap.
    const { agent, user } = await asStaff('gate-grandfather-staff@test.com');
    // Pre-create a client directly via service (no actor → bypasses policy; staff has no cap).
    await registry.oauthClients.create(
      { name: 'StaffExisting', redirect_uris: [], allowed_scopes: [] },
      user.id,
    );
    // Now staff has 1 active client → grandfathered; group gate is bypassed.
    const res = await agent.post('/api/oauth-clients').send({
      name: 'StaffGrandfathered',
      redirect_uris: [],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(201);
  });

  it('admin user with no group → 201 (admin bypass)', async () => {
    const { agent } = await asAdmin();
    const res = await agent.post('/api/oauth-clients').send({
      name: 'AdminNoGroupApp',
      redirect_uris: [],
      allowed_scopes: ['profile', 'users:read'],
    });
    expect(res.status).toBe(201);
  });

  it('staff with group permission and no existing clients → 201', async () => {
    const { agent } = await asStaffWithOauthGroup('gate-staff-permitted@test.com');
    const res = await agent.post('/api/oauth-clients').send({
      name: 'StaffPermittedApp',
      redirect_uris: [],
      allowed_scopes: ['profile', 'users:read'],
    });
    expect(res.status).toBe(201);
  });

  it('cap from sprint 023 still applies after group gate passes', async () => {
    // Student has group permission and no existing clients → gate passes.
    // Then attempts to create a second → cap (student cap=1) blocks it.
    const { agent, user } = await asStudentWithOauthGroup('gate-cap-still@test.com');
    // Create first client via service (bypasses policy for setup).
    await registry.oauthClients.create(
      { name: 'FirstSetup', redirect_uris: [], allowed_scopes: ['profile'] },
      user.id,
    );
    // Second create via route → student is grandfathered (1 client), cap blocks.
    const res = await agent.post('/api/oauth-clients').send({
      name: 'SecondBlocked',
      redirect_uris: [],
      allowed_scopes: ['profile'],
    });
    expect(res.status).toBe(403);
    // Verify it was a cap rejection, not a group gate rejection.
    const capEvents = await (prisma as any).auditEvent.findMany({
      where: { action: 'oauth_client_create_rejected_cap' },
    });
    expect(capEvents.length).toBeGreaterThan(0);
  });
});
