/**
 * GET /api/account/laptop and profile.laptopLogin on GET /api/account (sprint
 * 002 "laptop accounts" T006, SUC-006).
 *
 * The registry's LaptopAccountService is swapped for a
 * FakeLaptopRosterClient-backed instance so a reconcile can produce the
 * `lastWritten` timestamp.
 *
 * Covers:
 *  - 401 without a session
 *  - the five states as the row changes (ready, needs_password,
 *    invalid_username, disabled, ready for an admin)
 *  - dirty flag passthrough; lastWritten absent until a roster write, then
 *    the ISO time of that audit event
 *  - GET /api/account carries the same object as profile.laptopLogin
 *  - the roster bucket is never read or written by these endpoints
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { LaptopAccountService } from '../../../server/src/services/laptop/laptop-account.service.js';
import { FakeLaptopRosterClient } from '../helpers/fake-laptop-roster.client.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../server/src/app.js';

const HASH = '$6$rounds=5000$saltsalt$Qm4v1gG6k1WJ0b0w0vXk7y9xO3bX5Yd8m3dN6l2kH9pR1sT4uV7wX0yZ2aB5cD8eF1gH4iJ7kL0mN3oP6q';

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

/** Sign in via test-login and return the agent plus the user id. */
async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'student',
): Promise<{ agent: ReturnType<typeof request.agent>; id: number }> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, displayName: 'Test User', role }).expect(200);
  const user = await (prisma as any).user.findUnique({ where: { primary_email: email } });
  return { agent, id: user.id };
}

async function setRow(id: number, data: Record<string, unknown>): Promise<void> {
  await (prisma as any).user.update({ where: { id }, data });
}

const original = registry.laptopAccounts;
let roster: FakeLaptopRosterClient;
let laptopAccounts: LaptopAccountService;

beforeEach(async () => {
  await cleanDb();
  roster = new FakeLaptopRosterClient();
  laptopAccounts = new LaptopAccountService(roster, prisma as any, registry.audit);
  (registry as any).laptopAccounts = laptopAccounts;
});

afterAll(async () => {
  (registry as any).laptopAccounts = original;
  await cleanDb();
});

describe('GET /api/account/laptop — auth', () => {
  it('returns 401 with no session', async () => {
    const res = await request(app).get('/api/account/laptop');
    expect(res.status).toBe(401);
  });
});

describe('GET /api/account/laptop — states', () => {
  it('needs_password for a fresh social-login student (no username, no hash)', async () => {
    const { agent } = await loginAs('fresh@example.com');
    const res = await agent.get('/api/account/laptop');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: false, state: 'needs_password', username: null, dirty: false });
  });

  it('ready once the row has a valid username and a laptop hash', async () => {
    const { agent, id } = await loginAs('alice@example.com');
    await setRow(id, { username: 'alice', laptop_password_hash: HASH });
    const res = await agent.get('/api/account/laptop');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ enabled: true, state: 'ready', username: 'alice', dirty: false });
  });

  it('invalid_username when the username is not laptop-compatible', async () => {
    const { agent, id } = await loginAs('alice@example.com');
    await setRow(id, { username: 'Alice', laptop_password_hash: HASH });
    const res = await agent.get('/api/account/laptop');
    expect(res.body).toMatchObject({ enabled: false, state: 'invalid_username', username: 'Alice' });
  });

  it('disabled when the account is deactivated', async () => {
    const { agent, id } = await loginAs('alice@example.com');
    await setRow(id, { username: 'alice', laptop_password_hash: HASH, is_active: false });
    const res = await agent.get('/api/account/laptop');
    expect(res.body).toMatchObject({ enabled: false, state: 'disabled', username: 'alice' });
  });

  it('the legacy allows_laptop_account flag has no effect', async () => {
    const { agent, id } = await loginAs('alice@example.com');
    await setRow(id, { username: 'alice', laptop_password_hash: HASH, allows_laptop_account: false });
    const res = await agent.get('/api/account/laptop');
    expect(res.body).toMatchObject({ enabled: true, state: 'ready', username: 'alice' });
  });

  it('ready for an admin: the login is just the username and password', async () => {
    const { agent, id } = await loginAs('admin@example.com', 'admin');
    await setRow(id, { username: 'admin-1', laptop_password_hash: HASH });
    const res = await agent.get('/api/account/laptop');
    expect(res.body).toMatchObject({ enabled: true, state: 'ready', username: 'admin-1' });
  });

  it('ready for staff', async () => {
    const { agent, id } = await loginAs('staff@example.com', 'staff');
    await setRow(id, { username: 'staff-1', laptop_password_hash: HASH });
    const res = await agent.get('/api/account/laptop');
    expect(res.body).toMatchObject({ enabled: true, state: 'ready' });
  });

  it('passes the dirty flag through', async () => {
    const { agent, id } = await loginAs('alice@example.com');
    await setRow(id, { username: 'alice', laptop_password_hash: HASH, laptop_roster_dirty: true });
    const res = await agent.get('/api/account/laptop');
    expect(res.body).toMatchObject({ state: 'ready', dirty: true });
  });

  it('never touches the roster', async () => {
    const { agent, id } = await loginAs('alice@example.com');
    await setRow(id, { username: 'alice', laptop_password_hash: HASH });
    roster.failReads = true;
    roster.failWrites = true;
    const res = await agent.get('/api/account/laptop');
    expect(res.status).toBe(200);
    expect(roster.writes).toHaveLength(0);
  });
});

describe('GET /api/account/laptop — lastWritten', () => {
  it('is absent until the roster has been written, then the time of that write', async () => {
    const { agent, id } = await loginAs('alice@example.com');
    await setRow(id, { username: 'alice', laptop_password_hash: HASH });

    const before = await agent.get('/api/account/laptop');
    expect(before.body).not.toHaveProperty('lastWritten');

    expect(await laptopAccounts.reconcile(id, id)).toBe('written');
    const event = await (prisma as any).auditEvent.findFirst({
      where: { action: 'laptop_roster_written', target_user_id: id },
    });

    const after = await agent.get('/api/account/laptop');
    expect(after.body.lastWritten).toBe(new Date(event.created_at).toISOString());
    expect(after.body).toMatchObject({ state: 'ready', dirty: false });
  });

  it('counts a lock as a write', async () => {
    const { agent, id } = await loginAs('alice@example.com');
    await setRow(id, { username: 'alice', laptop_password_hash: HASH });
    roster.seed({ id: 'alice', display_name: 'Alice', password_hash: HASH, created: '20260825T170542Z', created_host: 'x' });
    await setRow(id, { is_active: false });

    expect(await laptopAccounts.reconcile(id, null)).toBe('locked');

    const res = await agent.get('/api/account/laptop');
    expect(res.body.state).toBe('disabled');
    expect(typeof res.body.lastWritten).toBe('string');
  });
});

describe('GET /api/account — profile.laptopLogin', () => {
  it('carries the same object as /api/account/laptop', async () => {
    const { agent, id } = await loginAs('alice@example.com');
    await setRow(id, { username: 'alice', laptop_password_hash: HASH, laptop_roster_dirty: true });
    await laptopAccounts.reconcile(id, id); // clears dirty, writes, records lastWritten

    const [account, laptop] = await Promise.all([agent.get('/api/account'), agent.get('/api/account/laptop')]);
    expect(account.status).toBe(200);
    expect(laptop.status).toBe(200);
    expect(account.body.profile.laptopLogin).toEqual(laptop.body);
    expect(account.body.profile.laptopLogin).toMatchObject({ enabled: true, state: 'ready', username: 'alice', dirty: false });
    expect(typeof account.body.profile.laptopLogin.lastWritten).toBe('string');
  });

  it('is present (needs_password) for a user with no credentials at all', async () => {
    const { agent } = await loginAs('fresh@example.com');
    const res = await agent.get('/api/account');
    expect(res.body.profile.laptopLogin).toEqual({ enabled: false, state: 'needs_password', username: null, dirty: false });
  });
});
