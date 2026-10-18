/**
 * Laptop write-back through the self-service credential paths (sprint 002
 * T004, SUC-002): PATCH /api/account/credentials, PATCH /api/account/profile,
 * POST /api/account/complete-onboarding and POST /api/auth/passphrase-signup.
 *
 * The registry's LaptopAccountService and UserService are swapped for
 * FakeLaptopRosterClient-backed instances so the roster can be inspected.
 *
 * Covers:
 *  - first-time credentials → roster entry with a `$6$` hash that
 *    verifyCryptHash accepts for the plaintext, created_host student-accounts
 *  - password change → new hash, `created` / `created_host` preserved
 *  - username rules with the flag on: Alice, student, ab, a.b rejected with
 *    the laptop message; alice-2 accepted; an id in the roster for someone
 *    else (or nobody here) rejected with the "already used" message
 *  - flag off → legacy rules (Alice → alice) and no roster traffic
 *  - write failure → 200, password changed, laptop_roster_dirty; the job
 *    clears it once writes work
 *  - display-name edits reach the roster
 *  - passphrase signup: Alice rejected, laptop hash stored, entry written,
 *    roster id owned elsewhere refused
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import {
  LaptopAccountService,
  LAPTOP_USERNAME_RULES_MESSAGE,
  LAPTOP_USERNAME_TAKEN_MESSAGE,
} from '../../../server/src/services/laptop/laptop-account.service.js';
import { UserService } from '../../../server/src/services/user.service.js';
import { PassphraseService } from '../../../server/src/services/passphrase.service.js';
import { createLaptopRosterPushJobHandler } from '../../../server/src/jobs/laptop-roster-push.job.js';
import { hashPassword, makeCryptHash, verifyCryptHash, verifyPassword } from '../../../server/src/utils/password.js';
import type { RosterEntry } from '../../../server/src/services/laptop/laptop-roster.client.js';
import { FakeLaptopRosterClient } from '../helpers/fake-laptop-roster.client.js';
import { makeGroup } from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../server/src/app.js';

function entry(id: string, extra: Partial<RosterEntry> = {}): RosterEntry {
  return {
    id,
    display_name: id[0].toUpperCase() + id.slice(1),
    password_hash: makeCryptHash('whatever'),
    created: '20260825T170542Z',
    created_host: 'jtl-inspiron-ABC123',
    ...extra,
  };
}

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).group.deleteMany();
}

/** Sign in via test-login. test-login upserts by email and rewrites display_name. */
async function loginAs(
  email: string,
  displayName: string,
): Promise<{ agent: ReturnType<typeof request.agent>; id: number }> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, displayName, role: 'student' });
  const user = await (prisma as any).user.findUnique({ where: { primary_email: email } });
  return { agent, id: user.id };
}

/** A student who already has a username and password (both hash forms). */
async function makeCredentialedUser(opts: {
  email: string;
  username: string;
  password: string;
  displayName?: string;
  allowsLaptopAccount?: boolean;
}): Promise<number> {
  const user = await (prisma as any).user.create({
    data: {
      display_name: opts.displayName ?? opts.username,
      primary_email: opts.email,
      username: opts.username,
      password_hash: await hashPassword(opts.password),
      laptop_password_hash: makeCryptHash(opts.password),
      role: 'student',
      created_via: 'passphrase_signup',
      is_active: true,
      onboarding_completed: true,
      approval_status: 'approved',
      allows_laptop_account: opts.allowsLaptopAccount ?? true,
    },
  });
  await (prisma as any).login.create({
    data: { user_id: user.id, provider: 'username', provider_user_id: `test:0:${opts.username}` },
  });
  return user.id;
}

async function reload(id: number) {
  return (prisma as any).user.findUnique({ where: { id } });
}

const original = { laptopAccounts: registry.laptopAccounts, users: registry.users };
let roster: FakeLaptopRosterClient;
let laptopAccounts: LaptopAccountService;

beforeEach(async () => {
  await cleanDb();
  roster = new FakeLaptopRosterClient();
  laptopAccounts = new LaptopAccountService(roster, prisma as any, registry.audit);
  (registry as any).laptopAccounts = laptopAccounts;
  (registry as any).users = new UserService(prisma as any, registry.audit, laptopAccounts);
});

afterAll(async () => {
  (registry as any).laptopAccounts = original.laptopAccounts;
  (registry as any).users = original.users;
  await cleanDb();
});

// ---------------------------------------------------------------------------
// PATCH /api/account/credentials — write-back
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — first-time setup writes the roster', () => {
  it('stores a $6$ hash that verifies against the plaintext and writes students/<username>', async () => {
    const { agent, id } = await loginAs('alice@example.com', 'Alice Liddell');

    const res = await agent
      .patch('/api/account/credentials')
      .send({ username: 'alice', newPassword: 'purple-cactus-river' });

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ id, username: 'alice' });

    const user = await reload(id);
    expect(user.laptop_password_hash).toMatch(/^\$6\$/);
    expect(verifyCryptHash('purple-cactus-river', user.laptop_password_hash)).toBe(true);
    expect(await verifyPassword('purple-cactus-river', user.password_hash)).toBe(true);
    expect(user.laptop_roster_dirty).toBe(false);

    const e = roster.entries.get('alice')!;
    expect(e).toBeDefined();
    expect(e).toMatchObject({
      id: 'alice',
      display_name: 'Alice Liddell',
      password_hash: user.laptop_password_hash,
      created_host: 'student-accounts',
      managed_by: 'student-accounts',
    });
    expect(e.created).toMatch(/^\d{8}T\d{6}Z$/);

    const events = await (prisma as any).auditEvent.findMany({ where: { action: 'laptop_roster_written' } });
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(id);
    expect(events[0].target_user_id).toBe(id);
  });
});

describe('PATCH /api/account/credentials — password change', () => {
  it('writes the new hash and preserves created / created_host from the laptop-written entry', async () => {
    const id = await makeCredentialedUser({
      email: 'bob@example.com',
      username: 'bob',
      password: 'old-password',
      displayName: 'Bob',
    });
    const before = await reload(id);
    roster.seed(entry('bob', { display_name: 'Bob', password_hash: before.laptop_password_hash }));
    const { agent } = await loginAs('bob@example.com', 'Bob');

    const res = await agent
      .patch('/api/account/credentials')
      .send({ currentPassword: 'old-password', newPassword: 'new-password' });

    expect(res.status, res.text).toBe(200);
    const after = await reload(id);
    expect(after.laptop_password_hash).not.toBe(before.laptop_password_hash);
    expect(verifyCryptHash('new-password', after.laptop_password_hash)).toBe(true);

    const e = roster.entries.get('bob')!;
    expect(e.password_hash).toBe(after.laptop_password_hash);
    expect(verifyCryptHash('new-password', e.password_hash)).toBe(true);
    expect(verifyCryptHash('old-password', e.password_hash)).toBe(false);
    expect(e.created).toBe('20260825T170542Z');
    expect(e.created_host).toBe('jtl-inspiron-ABC123');
    expect(e.managed_by).toBe('student-accounts');
    expect(roster.writes).toHaveLength(1);
  });

  it('a roster write failure does not fail the password change; the user is marked dirty and the job repairs it', async () => {
    const id = await makeCredentialedUser({ email: 'bob@example.com', username: 'bob', password: 'old-password' });
    roster.failWrites = true;
    const { agent } = await loginAs('bob@example.com', 'bob');

    const res = await agent
      .patch('/api/account/credentials')
      .send({ currentPassword: 'old-password', newPassword: 'new-password' });

    expect(res.status, res.text).toBe(200);
    const after = await reload(id);
    expect(await verifyPassword('new-password', after.password_hash)).toBe(true);
    expect(after.laptop_roster_dirty).toBe(true);
    expect(roster.entries.has('bob')).toBe(false);

    roster.failWrites = false;
    await createLaptopRosterPushJobHandler({ prisma, laptopAccounts })();

    expect((await reload(id)).laptop_roster_dirty).toBe(false);
    expect(verifyCryptHash('new-password', roster.entries.get('bob')!.password_hash)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// PATCH /api/account/credentials — username rules
// ---------------------------------------------------------------------------

describe('PATCH /api/account/credentials — laptop username rules (flag on)', () => {
  it.each([
    ['Alice', 'upper case'],
    ['student', 'reserved system name'],
    ['ab', 'too short'],
    ['a.b', 'dot (legacy rules allowed it)'],
    ['_alice', 'leading underscore'],
    ['a'.repeat(33), 'too long'],
  ])('rejects %s (%s) with the laptop message', async (username) => {
    const { agent, id } = await loginAs('alice@example.com', 'Alice');

    const res = await agent.patch('/api/account/credentials').send({ username, newPassword: 'purple-cactus-river' });

    expect(res.status, res.text).toBe(400);
    expect(res.body.error).toBe(LAPTOP_USERNAME_RULES_MESSAGE);
    expect((await reload(id)).username).toBeNull();
    expect(roster.writes).toHaveLength(0);
  });

  it('accepts alice-2', async () => {
    const { agent, id } = await loginAs('alice@example.com', 'Alice');

    const res = await agent
      .patch('/api/account/credentials')
      .send({ username: 'alice-2', newPassword: 'purple-cactus-river' });

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ id, username: 'alice-2' });
    expect(roster.entries.has('alice-2')).toBe(true);
  });

  it('rejects an id the roster holds for nobody here (never imported)', async () => {
    roster.seed(entry('zoe'));
    const { agent, id } = await loginAs('alice@example.com', 'Alice');

    const res = await agent.patch('/api/account/credentials').send({ username: 'zoe', newPassword: 'purple-cactus-river' });

    expect(res.status, res.text).toBe(409);
    expect(res.body.error).toBe(LAPTOP_USERNAME_TAKEN_MESSAGE);
    expect((await reload(id)).username).toBeNull();
    expect(roster.entries.get('zoe')!.display_name).toBe('Zoe'); // untouched
  });

  it('rejects an id the roster holds for another user here', async () => {
    roster.seed(entry('yan'));
    await makeCredentialedUser({ email: 'yan@example.com', username: 'yan', password: 'x' });
    const { agent } = await loginAs('alice@example.com', 'Alice');

    const res = await agent.patch('/api/account/credentials').send({ username: 'yan', newPassword: 'purple-cactus-river' });

    expect(res.status, res.text).toBe(409);
    expect(res.body.error).toBe(LAPTOP_USERNAME_TAKEN_MESSAGE);
  });

  it('still reports a plain username collision here as 409', async () => {
    await makeCredentialedUser({ email: 'yan@example.com', username: 'yan', password: 'x' });
    const { agent } = await loginAs('alice@example.com', 'Alice');

    const res = await agent.patch('/api/account/credentials').send({ username: 'yan', newPassword: 'purple-cactus-river' });

    expect(res.status, res.text).toBe(409);
    expect(res.body.error).toMatch(/already taken/i);
  });
});

describe('PATCH /api/account/credentials — legacy rules when allows_laptop_account is off', () => {
  it('lower-cases Alice to alice and never touches the roster', async () => {
    const { agent, id } = await loginAs('alice@example.com', 'Alice');
    await (prisma as any).user.update({ where: { id }, data: { allows_laptop_account: false } });

    const res = await agent.patch('/api/account/credentials').send({ username: 'Alice', newPassword: 'purple-cactus-river' });

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ id, username: 'alice' });
    const user = await reload(id);
    expect(user.laptop_password_hash).toMatch(/^\$6\$/); // kept for when the flag comes back on
    expect(roster.writes).toHaveLength(0);
    expect(user.laptop_roster_dirty).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Display-name paths
// ---------------------------------------------------------------------------

describe('display-name changes reach the roster', () => {
  it('PATCH /api/account/profile rewrites display_name, keeping the hash and created', async () => {
    const id = await makeCredentialedUser({ email: 'bob@example.com', username: 'bob', password: 'pw', displayName: 'Bob' });
    const hash = (await reload(id)).laptop_password_hash;
    roster.seed(entry('bob', { display_name: 'Bob', password_hash: hash }));
    const { agent } = await loginAs('bob@example.com', 'Bob');

    const res = await agent.patch('/api/account/profile').send({ displayName: 'Robert' });

    expect(res.status, res.text).toBe(200);
    const e = roster.entries.get('bob')!;
    expect(e.display_name).toBe('Robert');
    expect(e.password_hash).toBe(hash);
    expect(e.created).toBe('20260825T170542Z');
  });

  it('PATCH /api/account/profile with only notificationEmail does not touch the roster', async () => {
    const id = await makeCredentialedUser({ email: 'bob@example.com', username: 'bob', password: 'pw', displayName: 'Bob' });
    roster.seed(entry('bob', { display_name: 'Bob', password_hash: (await reload(id)).laptop_password_hash }));
    const { agent } = await loginAs('bob@example.com', 'Bob');

    await agent.patch('/api/account/profile').send({ notificationEmail: null }).expect(200);

    expect(roster.writes).toHaveLength(0);
  });

  it('POST /api/account/complete-onboarding rewrites display_name', async () => {
    const id = await makeCredentialedUser({ email: 'bob@example.com', username: 'bob', password: 'pw', displayName: 'Bob' });
    roster.seed(entry('bob', { display_name: 'Bob', password_hash: (await reload(id)).laptop_password_hash }));
    const { agent } = await loginAs('bob@example.com', 'Bob');

    await agent.post('/api/account/complete-onboarding').send({ displayName: 'Robert B.' }).expect(200);

    expect(roster.entries.get('bob')!.display_name).toBe('Robert B.');
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/passphrase-signup
// ---------------------------------------------------------------------------

async function makeGroupWithPassphrase(passphrase: string): Promise<number> {
  const group = await makeGroup({ name: `Laptop Signup ${passphrase}` });
  const now = new Date();
  await (prisma as any).group.update({
    where: { id: group.id },
    data: {
      signup_passphrase: passphrase,
      signup_passphrase_grant_llm_proxy: false,
      signup_passphrase_expires_at: new Date(now.getTime() + PassphraseService.TTL_MS),
      signup_passphrase_created_at: now,
      signup_passphrase_created_by: 1,
    },
  });
  return group.id;
}

describe('POST /api/auth/passphrase-signup — laptop write-back', () => {
  it('stores the laptop hash and writes the roster entry', async () => {
    await makeGroupWithPassphrase('signup-word-one');

    const res = await request(app).post('/api/auth/passphrase-signup').send({
      username: 'dana',
      passphrase: 'signup-word-one',
      password: 'SecurePass1!',
      displayName: 'Dana Scully',
      email: 'dana@test.example.com',
    });

    expect(res.status, res.text).toBe(200);
    const user = await (prisma as any).user.findUnique({ where: { username: 'dana' } });
    expect(user.laptop_password_hash).toMatch(/^\$6\$/);
    expect(verifyCryptHash('SecurePass1!', user.laptop_password_hash)).toBe(true);
    expect(user.allows_laptop_account).toBe(true);
    expect(user.laptop_roster_dirty).toBe(false);

    const e = roster.entries.get('dana')!;
    expect(e).toMatchObject({
      id: 'dana',
      display_name: 'Dana Scully',
      password_hash: user.laptop_password_hash,
      created_host: 'student-accounts',
      managed_by: 'student-accounts',
    });
  });

  it.each([['Alice'], ['student'], ['ab'], ['a_b']])('rejects %s with the laptop message', async (username) => {
    await makeGroupWithPassphrase('signup-word-two');

    const res = await request(app).post('/api/auth/passphrase-signup').send({
      username,
      passphrase: 'signup-word-two',
      password: 'SecurePass1!',
      displayName: 'Test User',
      email: 'shape@test.example.com',
    });

    expect(res.status, res.text).toBe(400);
    expect(res.body.error).toBe(LAPTOP_USERNAME_RULES_MESSAGE);
    expect(await (prisma as any).user.count()).toBe(0);
  });

  it('refuses a username the roster already holds for someone not imported here', async () => {
    roster.seed(entry('zoe'));
    await makeGroupWithPassphrase('signup-word-three');

    const res = await request(app).post('/api/auth/passphrase-signup').send({
      username: 'zoe',
      passphrase: 'signup-word-three',
      password: 'SecurePass1!',
      displayName: 'Impostor',
      email: 'zoe@test.example.com',
    });

    expect(res.status, res.text).toBe(409);
    expect(res.body.error).toBe(LAPTOP_USERNAME_TAKEN_MESSAGE);
    expect(await (prisma as any).user.count()).toBe(0);
    expect(roster.writes).toHaveLength(0);
  });

  it('a roster write failure does not fail the signup; the user is dirty', async () => {
    roster.failWrites = true;
    await makeGroupWithPassphrase('signup-word-four');

    const res = await request(app).post('/api/auth/passphrase-signup').send({
      username: 'erin',
      passphrase: 'signup-word-four',
      password: 'SecurePass1!',
      displayName: 'Erin',
      email: 'erin@test.example.com',
    });

    expect(res.status, res.text).toBe(200);
    const user = await (prisma as any).user.findUnique({ where: { username: 'erin' } });
    expect(user.laptop_roster_dirty).toBe(true);
  });
});
