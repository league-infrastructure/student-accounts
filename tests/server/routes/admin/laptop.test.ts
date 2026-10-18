/**
 * Integration tests for the admin laptop roster surface (sprint 002 T004,
 * SUC-007): POST /api/admin/laptop/push-all and the admin paths that must
 * reconcile a user's roster entry (permissions flag, soft-delete, deny,
 * display-name edit).
 *
 * The registry's roster client and LaptopAccountService are swapped for
 * FakeLaptopRosterClient-backed instances (same pattern as import.test.ts).
 *
 * Covers:
 *  - 401 unauthenticated, 403 student
 *  - 503 when the roster is not configured; nothing is marked dirty
 *  - 200 with { written, locked, unchanged, skipped, failed } counts and a
 *    laptop_push_all audit event with the admin as actor
 *  - write failures are counted and leave the users dirty
 *  - PATCH /users/:id/permissions: the retired allows_laptop_account is
 *    ignored (no roster write, no audit); other flags do not touch the roster
 *  - DELETE /users/:id and POST /users/:id/deny-approval lock the entry
 *  - PUT /users/:id displayName → entry display_name updated
 *
 * T006 (per-user "Push now" and the detail payload):
 *  - POST /users/:id/laptop/push: 401/403, 400 bad id, 404 unknown user,
 *    503 not configured; 200 { outcome, laptopLogin } for written / locked /
 *    unchanged / skipped; a write failure is outcome 'failed' with
 *    dirty: true; the admin is the audit actor
 *  - GET /users/:id carries username, laptop_roster_dirty and laptop_login_state
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { LaptopAccountService } from '../../../../server/src/services/laptop/laptop-account.service.js';
import {
  UnconfiguredLaptopRosterClient,
  type RosterClient,
  type RosterEntry,
} from '../../../../server/src/services/laptop/laptop-roster.client.js';
import { UserService } from '../../../../server/src/services/user.service.js';
import { FakeLaptopRosterClient } from '../../helpers/fake-laptop-roster.client.js';
import { makeUser } from '../../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../../server/src/app.js';

const HASH = '$6$rounds=5000$saltsalt$Qm4v1gG6k1WJ0b0w0vXk7y9xO3bX5Yd8m3dN6l2kH9pR1sT4uV7wX0yZ2aB5cD8eF1gH4iJ7kL0mN3oP6q';

function entry(id: string, extra: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id,
    display_name: id[0].toUpperCase() + id.slice(1),
    password_hash: HASH,
    created: '20260825T170542Z',
    created_host: 'jtl-inspiron-ABC123',
    ...extra,
  };
}

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).group.deleteMany();
}

async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
): Promise<{ agent: ReturnType<typeof request.agent>; id: number }> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  const user = await (prisma as any).user.findUnique({ where: { primary_email: email } });
  return { agent, id: user.id };
}

async function makeLaptopUser(username: string, overrides: Parameters<typeof makeUser>[0] = {}) {
  return makeUser({
    username,
    display_name: username[0].toUpperCase() + username.slice(1),
    password_hash: 'deadbeef:cafebabe',
    laptop_password_hash: HASH,
    ...overrides,
  });
}

async function reload(id: number) {
  return (prisma as any).user.findUnique({ where: { id } });
}

const original = {
  laptopRoster: registry.laptopRoster,
  laptopAccounts: registry.laptopAccounts,
  users: registry.users,
};

function install(roster: RosterClient): void {
  const laptopAccounts = new LaptopAccountService(roster, prisma as any, registry.audit);
  (registry as any).laptopRoster = roster;
  (registry as any).laptopAccounts = laptopAccounts;
  (registry as any).users = new UserService(prisma as any, registry.audit, laptopAccounts);
}

let roster: FakeLaptopRosterClient;

beforeEach(async () => {
  await cleanDb();
  roster = new FakeLaptopRosterClient();
  install(roster);
});

afterAll(async () => {
  (registry as any).laptopRoster = original.laptopRoster;
  (registry as any).laptopAccounts = original.laptopAccounts;
  (registry as any).users = original.users;
  await cleanDb();
});

// ---------------------------------------------------------------------------
// POST /api/admin/laptop/push-all
// ---------------------------------------------------------------------------

describe('POST /api/admin/laptop/push-all — auth', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await request(app).post('/api/admin/laptop/push-all').send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for a student session', async () => {
    const { agent } = await loginAs('student@example.com', 'student');
    const res = await agent.post('/api/admin/laptop/push-all').send({});
    expect(res.status).toBe(403);
  });
});

describe('POST /api/admin/laptop/push-all — not configured', () => {
  it('returns 503 and marks nobody dirty', async () => {
    install(new UnconfiguredLaptopRosterClient());
    const user = await makeLaptopUser('alice');
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.post('/api/admin/laptop/push-all').send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
    expect((await reload(user.id)).laptop_roster_dirty).toBe(false);
    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'laptop_push_all' } });
    expect(events).toHaveLength(0);
  });
});

describe('POST /api/admin/laptop/push-all — admin', () => {
  it('reconciles every user with a username and returns the counts', async () => {
    await makeLaptopUser('alice'); // written
    await makeLaptopUser('bob'); // unchanged
    roster.seed(entry('bob'));
    await makeLaptopUser('carol', { is_active: false }); // locked
    roster.seed(entry('carol'));
    await makeLaptopUser('dave', { laptop_password_hash: null }); // skipped
    const { agent, id: adminId } = await loginAs('admin@example.com');

    const res = await agent.post('/api/admin/laptop/push-all').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ written: 1, locked: 1, unchanged: 1, skipped: 1, failed: 0 });
    expect(roster.entries.get('alice')!.password_hash).toBe(HASH);
    expect(roster.entries.get('alice')!.created_host).toBe('student-accounts');
    expect(roster.entries.get('carol')!.password_hash).toBe('!');

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'laptop_push_all' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(adminId);
    expect(events[0].details).toMatchObject({ written: 1, locked: 1, unchanged: 1, skipped: 1, failed: 0 });

    // Per-user events carry the admin as actor too.
    const written = await (prisma as any).auditEvent.findMany({ where: { action: 'laptop_roster_written' } });
    expect(written).toHaveLength(1);
    expect(written[0].actor_user_id).toBe(adminId);
  });

  it('counts write failures and leaves those users dirty', async () => {
    const a = await makeLaptopUser('alice');
    const b = await makeLaptopUser('bob');
    roster.failWrites = true;
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.post('/api/admin/laptop/push-all').send({});

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ written: 0, locked: 0, unchanged: 0, skipped: 0, failed: 2 });
    expect((await reload(a.id)).laptop_roster_dirty).toBe(true);
    expect((await reload(b.id)).laptop_roster_dirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Admin paths that reconcile the roster
// ---------------------------------------------------------------------------

describe('PATCH /api/admin/users/:id/permissions — retired allows_laptop_account', () => {
  it('is ignored: the entry stays usable, nothing is written or audited', async () => {
    const user = await makeLaptopUser('alice');
    roster.seed(entry('alice'));
    const { agent } = await loginAs('admin@example.com');

    const res = await agent
      .patch(`/api/admin/users/${user.id}/permissions`)
      .send({ allows_laptop_account: false });

    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('allowsLaptopAccount');
    expect((await reload(user.id)).allows_laptop_account).toBe(true);
    expect(roster.writes).toHaveLength(0);
    expect(roster.entries.get('alice')!.password_hash).toBe(HASH);
    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'user_permission_changed', target_user_id: user.id },
    });
    expect(events).toHaveLength(0);
  });

  it('does not touch the roster when another flag changes', async () => {
    const user = await makeLaptopUser('alice');
    roster.seed(entry('alice'));
    const { agent } = await loginAs('admin@example.com');

    await agent.patch(`/api/admin/users/${user.id}/permissions`).send({ allows_oauth_client: true }).expect(200);

    expect(roster.writes).toHaveLength(0);
  });
});

describe('DELETE /api/admin/users/:id — soft delete locks the roster entry', () => {
  it('writes ! and keeps created', async () => {
    const user = await makeLaptopUser('alice');
    roster.seed(entry('alice'));
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.delete(`/api/admin/users/${user.id}`);

    expect(res.status).toBe(200);
    expect((await reload(user.id)).is_active).toBe(false);
    expect(roster.entries.get('alice')!.password_hash).toBe('!');
    expect(roster.entries.get('alice')!.created).toBe('20260825T170542Z');
  });

  it('writes nothing for a user who never had a roster entry', async () => {
    const user = await makeLaptopUser('alice');
    const { agent } = await loginAs('admin@example.com');

    await agent.delete(`/api/admin/users/${user.id}`).expect(200);

    expect(roster.writes).toHaveLength(0);
  });
});

describe('POST /api/admin/users/:id/deny-approval — locks the roster entry', () => {
  it('writes !', async () => {
    const user = await makeLaptopUser('alice');
    await (prisma as any).user.update({ where: { id: user.id }, data: { approval_status: 'pending' } });
    roster.seed(entry('alice'));
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.post(`/api/admin/users/${user.id}/deny-approval`).send({});

    expect(res.status).toBe(200);
    expect(roster.entries.get('alice')!.password_hash).toBe('!');
  });
});

describe('PUT /api/admin/users/:id — display name reaches the roster', () => {
  it('rewrites the entry with the new display_name', async () => {
    const user = await makeLaptopUser('alice');
    roster.seed(entry('alice'));
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.put(`/api/admin/users/${user.id}`).send({ displayName: 'Alice Liddell' });

    expect(res.status).toBe(200);
    const e = roster.entries.get('alice')!;
    expect(e.display_name).toBe('Alice Liddell');
    expect(e.password_hash).toBe(HASH);
    expect(e.created).toBe('20260825T170542Z');
  });

  it('does not touch the roster when only the role changes', async () => {
    const user = await makeLaptopUser('alice');
    roster.seed(entry('alice'));
    const { agent } = await loginAs('admin@example.com');

    await agent.put(`/api/admin/users/${user.id}`).send({ role: 'staff' }).expect(200);

    expect(roster.writes).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/laptop/push (T006)
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/laptop/push — auth and validation', () => {
  it('returns 401 when not authenticated', async () => {
    const user = await makeLaptopUser('alice');
    const res = await request(app).post(`/api/admin/users/${user.id}/laptop/push`).send({});
    expect(res.status).toBe(401);
  });

  it('returns 403 for a student session', async () => {
    const user = await makeLaptopUser('alice');
    const { agent } = await loginAs('student@example.com', 'student');
    const res = await agent.post(`/api/admin/users/${user.id}/laptop/push`).send({});
    expect(res.status).toBe(403);
  });

  it('returns 400 for a non-numeric id and 404 for an unknown user', async () => {
    const { agent } = await loginAs('admin@example.com');
    expect((await agent.post('/api/admin/users/abc/laptop/push').send({})).status).toBe(400);
    expect((await agent.post('/api/admin/users/999999/laptop/push').send({})).status).toBe(404);
  });

  it('returns 503 when the roster is not configured and marks nobody dirty', async () => {
    install(new UnconfiguredLaptopRosterClient());
    const user = await makeLaptopUser('alice');
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.post(`/api/admin/users/${user.id}/laptop/push`).send({});

    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/not configured/i);
    expect((await reload(user.id)).laptop_roster_dirty).toBe(false);
  });
});

describe('POST /api/admin/users/:id/laptop/push — outcomes', () => {
  it('writes the entry and returns outcome written with the ready state and lastWritten', async () => {
    const user = await makeLaptopUser('alice', { laptop_roster_dirty: true });
    const { agent, id: adminId } = await loginAs('admin@example.com');

    const res = await agent.post(`/api/admin/users/${user.id}/laptop/push`).send({});

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('written');
    expect(res.body.laptopLogin).toMatchObject({ enabled: true, state: 'ready', username: 'alice', dirty: false });
    expect(typeof res.body.laptopLogin.lastWritten).toBe('string');
    expect(roster.entries.get('alice')!.password_hash).toBe(HASH);
    expect((await reload(user.id)).laptop_roster_dirty).toBe(false);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'laptop_roster_written' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(adminId);
    expect(events[0].target_user_id).toBe(user.id);
  });

  it('locks the entry for a deactivated user and reports disabled', async () => {
    const user = await makeLaptopUser('alice', { is_active: false });
    roster.seed(entry('alice'));
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.post(`/api/admin/users/${user.id}/laptop/push`).send({});

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('locked');
    expect(res.body.laptopLogin).toMatchObject({ enabled: false, state: 'disabled', dirty: false });
    expect(roster.entries.get('alice')!.password_hash).toBe('!');
  });

  it('reports unchanged when the roster already matches, and skipped when there is nothing to write', async () => {
    const same = await makeLaptopUser('bob');
    roster.seed(entry('bob'));
    const noPassword = await makeLaptopUser('carol', { laptop_password_hash: null });
    const { agent } = await loginAs('admin@example.com');

    const unchanged = await agent.post(`/api/admin/users/${same.id}/laptop/push`).send({});
    expect(unchanged.status).toBe(200);
    expect(unchanged.body.outcome).toBe('unchanged');
    expect(unchanged.body.laptopLogin.state).toBe('ready');

    const skipped = await agent.post(`/api/admin/users/${noPassword.id}/laptop/push`).send({});
    expect(skipped.status).toBe(200);
    expect(skipped.body.outcome).toBe('skipped');
    expect(skipped.body.laptopLogin).toMatchObject({ state: 'needs_password', dirty: false });
    expect(skipped.body.laptopLogin).not.toHaveProperty('lastWritten');
    expect(roster.writes).toHaveLength(0);
  });

  it('a write failure is a 200 with outcome failed and the user left dirty', async () => {
    const user = await makeLaptopUser('alice');
    roster.failWrites = true;
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.post(`/api/admin/users/${user.id}/laptop/push`).send({});

    expect(res.status).toBe(200);
    expect(res.body.outcome).toBe('failed');
    expect(res.body.laptopLogin).toMatchObject({ state: 'ready', dirty: true });
    expect((await reload(user.id)).laptop_roster_dirty).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/users/:id — laptop fields (T006)
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id — laptop login fields', () => {
  it('includes username, the dirty bit and the computed state, but not the retired flag', async () => {
    const user = await makeLaptopUser('alice', { laptop_roster_dirty: true });
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.get(`/api/admin/users/${user.id}`);

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      id: user.id,
      username: 'alice',
      laptop_roster_dirty: true,
      laptop_login_state: 'ready',
    });
    expect(res.body).not.toHaveProperty('allows_laptop_account');
  });

  it('reflects activity, role and the password in the state', async () => {
    const off = await makeLaptopUser('bob', { is_active: false });
    const admin = await makeLaptopUser('root-admin', { role: 'admin', allows_laptop_account: false });
    const noPw = await makeLaptopUser('carol', { laptop_password_hash: null });
    const badName = await makeLaptopUser('Dave');
    const { agent } = await loginAs('admin@example.com');

    expect((await agent.get(`/api/admin/users/${off.id}`)).body.laptop_login_state).toBe('disabled');
    expect((await agent.get(`/api/admin/users/${admin.id}`)).body.laptop_login_state).toBe('ready');
    expect((await agent.get(`/api/admin/users/${noPw.id}`)).body.laptop_login_state).toBe('needs_password');
    expect((await agent.get(`/api/admin/users/${badName.id}`)).body).toMatchObject({
      username: 'Dave',
      laptop_login_state: 'invalid_username',
    });
  });
});
