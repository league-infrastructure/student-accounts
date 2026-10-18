/**
 * Integration tests for the admin credential routes (sprint 002 T005,
 * SUC-003): GET/PUT /api/admin/users/:id/credentials and
 * POST /api/admin/users/:id/credentials/email.
 *
 * The registry's roster client / LaptopAccountService / UserService are
 * swapped for FakeLaptopRosterClient-backed instances (as in laptop.test.ts)
 * and registry.mail for a fake transport (as in account-test-email.test.ts).
 *
 * Covers:
 *  - 401 unauthenticated, 403 student, 404 unknown user
 *  - set username: Login row `admin:<id>:<username>`, audit, laptop rule
 *    message (flag on), legacy rules (flag off), 409 when taken
 *  - set password: POST /api/auth/login works, laptop hash verifies, roster
 *    entry written, audit without the password, min length
 *  - generate: three words, returned once, login works
 *  - email: fake transport gets recipient / username / password / site URL /
 *    laptop line / note; `.invalid` and malformed `to` refused; audit has
 *    the recipient and never the password; skipped result passed through
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import {
  LaptopAccountService,
  LAPTOP_USERNAME_RULES_MESSAGE,
} from '../../../../server/src/services/laptop/laptop-account.service.js';
import { UserService } from '../../../../server/src/services/user.service.js';
import {
  CREDENTIALS_EMAIL_SUBJECT,
  LAPTOP_LOGIN_LINE,
} from '../../../../server/src/services/mail.service.js';
import { verifyCryptHash, verifyPassword } from '../../../../server/src/utils/password.js';
import { FakeLaptopRosterClient } from '../../helpers/fake-laptop-roster.client.js';
import { makeUser } from '../../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Fakes
// ---------------------------------------------------------------------------

const fakeSend = vi.fn();
const fakeMail = {
  isConfigured: vi.fn().mockReturnValue(true),
  send: fakeSend,
};

const original = {
  laptopRoster: registry.laptopRoster,
  laptopAccounts: registry.laptopAccounts,
  users: registry.users,
  mail: registry.mail,
};

let roster: FakeLaptopRosterClient;

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
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

async function reload(id: number) {
  return (prisma as any).user.findUnique({ where: { id } });
}

async function auditEvents(action: string) {
  return (prisma as any).auditEvent.findMany({ where: { action }, orderBy: { id: 'asc' } });
}

beforeEach(async () => {
  await cleanDb();
  roster = new FakeLaptopRosterClient();
  const laptopAccounts = new LaptopAccountService(roster, prisma as any, registry.audit);
  (registry as any).laptopRoster = roster;
  (registry as any).laptopAccounts = laptopAccounts;
  (registry as any).users = new UserService(prisma as any, registry.audit, laptopAccounts);
  (registry as any).mail = fakeMail;
  fakeMail.isConfigured.mockReturnValue(true);
  fakeSend.mockReset();
  fakeSend.mockResolvedValue({ messageId: 'mid-test-001' });
});

afterAll(async () => {
  (registry as any).laptopRoster = original.laptopRoster;
  (registry as any).laptopAccounts = original.laptopAccounts;
  (registry as any).users = original.users;
  (registry as any).mail = original.mail;
  await cleanDb();
});

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

describe('admin credentials — auth', () => {
  it('returns 401 when not authenticated', async () => {
    const user = await makeUser();
    expect((await request(app).get(`/api/admin/users/${user.id}/credentials`)).status).toBe(401);
    expect(
      (await request(app).put(`/api/admin/users/${user.id}/credentials`).send({ username: 'alice' })).status,
    ).toBe(401);
    expect(
      (await request(app).post(`/api/admin/users/${user.id}/credentials/email`).send({ to: 'a@b.com' }))
        .status,
    ).toBe(401);
  });

  it('returns 403 for a student session', async () => {
    const user = await makeUser();
    const { agent } = await loginAs('student@example.com', 'student');
    expect((await agent.get(`/api/admin/users/${user.id}/credentials`)).status).toBe(403);
    expect((await agent.put(`/api/admin/users/${user.id}/credentials`).send({ username: 'alice' })).status).toBe(
      403,
    );
    expect(
      (await agent.post(`/api/admin/users/${user.id}/credentials/email`).send({ to: 'a@b.com' })).status,
    ).toBe(403);
    expect(fakeSend).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown user', async () => {
    const { agent } = await loginAs('admin@example.com');
    expect((await agent.get('/api/admin/users/999999/credentials')).status).toBe(404);
    expect((await agent.put('/api/admin/users/999999/credentials').send({ username: 'alice' })).status).toBe(404);
    expect(
      (await agent.post('/api/admin/users/999999/credentials/email').send({ to: 'parent@example.com' })).status,
    ).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// GET
// ---------------------------------------------------------------------------

describe('GET /api/admin/users/:id/credentials', () => {
  it('reports the current state without any hash', async () => {
    const user = await makeUser({
      display_name: 'Alice Liddell',
      primary_email: 'alice@example.com',
      username: 'alice',
      password_hash: 'deadbeef:cafebabe',
      laptop_password_hash: '$6$salt$hash',
    });
    await (prisma as any).user.update({
      where: { id: user.id },
      data: { notification_email: 'parent@example.com' },
    });
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.get(`/api/admin/users/${user.id}/credentials`);

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      username: 'alice',
      hasPassword: true,
      allowsLaptopAccount: true,
      laptopLogin: true,
      displayName: 'Alice Liddell',
      primaryEmail: 'alice@example.com',
      notificationEmail: 'parent@example.com',
    });
    expect(JSON.stringify(res.body)).not.toMatch(/deadbeef|\$6\$/);
  });

  it('laptopLogin is true for an eligible student and false with the flag off', async () => {
    const on = await makeUser({ username: 'alice', password_hash: 'a:b', laptop_password_hash: '$6$x$y' });
    const off = await makeUser({
      username: 'bob',
      password_hash: 'a:b',
      laptop_password_hash: '$6$x$y',
      allows_laptop_account: false,
    });
    const { agent } = await loginAs('admin@example.com');

    expect((await agent.get(`/api/admin/users/${on.id}/credentials`)).body.laptopLogin).toBe(true);
    const offBody = (await agent.get(`/api/admin/users/${off.id}/credentials`)).body;
    expect(offBody.laptopLogin).toBe(false);
    expect(offBody.allowsLaptopAccount).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// PUT — username
// ---------------------------------------------------------------------------

describe('PUT /api/admin/users/:id/credentials — username', () => {
  it('sets the username, creates the username Login row and audits', async () => {
    const user = await makeUser({ primary_email: 'alice@example.com' });
    const { agent, id: adminId } = await loginAs('admin@example.com');

    const res = await agent.put(`/api/admin/users/${user.id}/credentials`).send({ username: 'alice' });

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ username: 'alice' });
    expect((await reload(user.id)).username).toBe('alice');

    const logins = await (prisma as any).login.findMany({ where: { user_id: user.id } });
    expect(logins).toHaveLength(1);
    expect(logins[0]).toMatchObject({
      provider: 'username',
      provider_user_id: `admin:${user.id}:alice`,
      provider_email: 'alice@example.com',
      provider_username: 'alice',
    });

    const events = await auditEvents('admin_set_username');
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(adminId);
    expect(events[0].target_user_id).toBe(user.id);
    expect(events[0].details).toEqual({ username: 'alice' });
    expect(await auditEvents('admin_set_password')).toHaveLength(0);

    // No password yet → nothing to write to the roster.
    expect(roster.writes).toHaveLength(0);
  });

  it('does not add a second Login row when the user already has a username login', async () => {
    const user = await makeUser({ username: 'alice' });
    await (prisma as any).login.create({
      data: { user_id: user.id, provider: 'username', provider_user_id: `self:${user.id}:alice` },
    });
    const { agent } = await loginAs('admin@example.com');

    await agent.put(`/api/admin/users/${user.id}/credentials`).send({ username: 'alice-2' }).expect(200);

    const logins = await (prisma as any).login.findMany({ where: { user_id: user.id } });
    expect(logins).toHaveLength(1);
    expect((await reload(user.id)).username).toBe('alice-2');
  });

  it('rejects a username that breaks the laptop rules with the rule message (flag on)', async () => {
    const user = await makeUser();
    const { agent } = await loginAs('admin@example.com');

    for (const bad of ['Student', 'ab', 'a.b', 'root']) {
      const res = await agent.put(`/api/admin/users/${user.id}/credentials`).send({ username: bad });
      expect(res.status, bad).toBe(400);
      expect(res.body.error).toBe(LAPTOP_USERNAME_RULES_MESSAGE);
    }
    expect((await reload(user.id)).username).toBeNull();
    expect(await auditEvents('admin_set_username')).toHaveLength(0);
  });

  it('applies the legacy rules when allows_laptop_account is off (Alice → alice)', async () => {
    const user = await makeUser({ allows_laptop_account: false });
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.put(`/api/admin/users/${user.id}/credentials`).send({ username: 'Alice' });

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('alice');
  });

  it('returns 409 when another user has the username', async () => {
    await makeUser({ username: 'alice' });
    const user = await makeUser();
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.put(`/api/admin/users/${user.id}/credentials`).send({ username: 'alice' });

    expect(res.status).toBe(409);
    expect(res.body.error).toMatch(/already/i);
  });

  it('returns 400 for an empty body and for wrong types', async () => {
    const user = await makeUser();
    const { agent } = await loginAs('admin@example.com');

    expect((await agent.put(`/api/admin/users/${user.id}/credentials`).send({})).status).toBe(400);
    expect((await agent.put(`/api/admin/users/${user.id}/credentials`).send({ username: 5 })).status).toBe(400);
    expect(
      (await agent.put(`/api/admin/users/${user.id}/credentials`).send({ generatePassword: 'yes' })).status,
    ).toBe(400);
    expect(
      (
        await agent
          .put(`/api/admin/users/${user.id}/credentials`)
          .send({ password: 'purple-cactus-river', generatePassword: true })
      ).status,
    ).toBe(400);
  });
});

// ---------------------------------------------------------------------------
// PUT — password
// ---------------------------------------------------------------------------

describe('PUT /api/admin/users/:id/credentials — password', () => {
  it('sets a typed password: login works, laptop hash verifies, roster written, audit has no password', async () => {
    const user = await makeUser({ username: 'alice', display_name: 'Alice' });
    const { agent, id: adminId } = await loginAs('admin@example.com');

    const res = await agent
      .put(`/api/admin/users/${user.id}/credentials`)
      .send({ password: 'purple-cactus-river' });

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ username: 'alice', password: 'purple-cactus-river' });

    const after = await reload(user.id);
    expect(await verifyPassword('purple-cactus-river', after.password_hash)).toBe(true);
    expect(verifyCryptHash('purple-cactus-river', after.laptop_password_hash)).toBe(true);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: 'purple-cactus-river' });
    expect(login.status).toBe(200);
    expect(login.body.id).toBe(user.id);

    const entry = roster.entries.get('alice');
    expect(entry).toBeDefined();
    expect(entry!.password_hash).toBe(after.laptop_password_hash);
    expect(entry!.created_host).toBe('student-accounts');

    const events = await auditEvents('admin_set_password');
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(adminId);
    expect(events[0].target_user_id).toBe(user.id);
    expect(events[0].details).toEqual({ generated: false });
    const all = await (prisma as any).auditEvent.findMany();
    expect(JSON.stringify(all)).not.toContain('purple-cactus-river');
    expect(await auditEvents('admin_set_username')).toHaveLength(0);
  });

  it('rejects a password shorter than 4 characters or blank', async () => {
    const user = await makeUser({ username: 'alice' });
    const { agent } = await loginAs('admin@example.com');

    const short = await agent.put(`/api/admin/users/${user.id}/credentials`).send({ password: 'abc' });
    expect(short.status).toBe(400);
    expect(short.body.error).toMatch(/at least 4/);

    const blank = await agent.put(`/api/admin/users/${user.id}/credentials`).send({ password: '    ' });
    expect(blank.status).toBe(400);

    expect((await reload(user.id)).password_hash).toBeNull();
  });

  it('generates a three-word password, returns it once, and login works with it', async () => {
    const user = await makeUser({ username: 'alice' });
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.put(`/api/admin/users/${user.id}/credentials`).send({ generatePassword: true });

    expect(res.status, res.text).toBe(200);
    expect(res.body.username).toBe('alice');
    expect(res.body.password).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);

    const login = await request(app)
      .post('/api/auth/login')
      .send({ username: 'alice', password: res.body.password });
    expect(login.status).toBe(200);

    // The plaintext is not retrievable afterwards.
    const get = await agent.get(`/api/admin/users/${user.id}/credentials`);
    expect(get.body.hasPassword).toBe(true);
    expect(JSON.stringify(get.body)).not.toContain(res.body.password);

    const events = await auditEvents('admin_set_password');
    expect(events).toHaveLength(1);
    expect(events[0].details).toEqual({ generated: true });
    expect(JSON.stringify(events)).not.toContain(res.body.password);
  });

  it('sets username and generates a password in one call; the Login row and roster entry appear', async () => {
    const user = await makeUser({ display_name: 'Alice Liddell' });
    const { agent, id: adminId } = await loginAs('admin@example.com');

    const res = await agent
      .put(`/api/admin/users/${user.id}/credentials`)
      .send({ username: 'alice', generatePassword: true });

    expect(res.status, res.text).toBe(200);
    expect(res.body.username).toBe('alice');
    expect(res.body.password).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);

    const logins = await (prisma as any).login.findMany({ where: { user_id: user.id, provider: 'username' } });
    expect(logins).toHaveLength(1);
    expect(roster.entries.get('alice')!.display_name).toBe('Alice Liddell');
    expect(await auditEvents('admin_set_username')).toHaveLength(1);
    expect(await auditEvents('admin_set_password')).toHaveLength(1);
    const written = await auditEvents('laptop_roster_written');
    expect(written).toHaveLength(1);
    expect(written[0].actor_user_id).toBe(adminId);
  });

  it('a roster write failure does not fail the request; the user is marked dirty', async () => {
    const user = await makeUser({ username: 'alice' });
    roster.failWrites = true;
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.put(`/api/admin/users/${user.id}/credentials`).send({ password: 'purple-cactus-river' });

    expect(res.status).toBe(200);
    const after = await reload(user.id);
    expect(after.laptop_roster_dirty).toBe(true);
    expect(await verifyPassword('purple-cactus-river', after.password_hash)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// POST — email
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/credentials/email', () => {
  async function eligibleUser() {
    return makeUser({
      display_name: 'Alice Liddell',
      primary_email: 'alice@example.com',
      username: 'alice',
      password_hash: 'a:b',
      laptop_password_hash: '$6$x$y',
    });
  }

  it('sends to the given address with username, password, site URL and the laptop line; audits the recipient', async () => {
    const user = await eligibleUser();
    const { agent, id: adminId } = await loginAs('admin@example.com');

    const res = await agent
      .post(`/api/admin/users/${user.id}/credentials/email`)
      .set('x-forwarded-proto', 'https')
      .set('x-forwarded-host', 'accounts.jointheleague.org')
      .send({ to: 'parent@example.com', password: 'purple-cactus-river', note: 'See you Tuesday.' });

    expect(res.status, res.text).toBe(200);
    expect(res.body).toEqual({ sent: true });

    expect(fakeSend).toHaveBeenCalledTimes(1);
    const opts = fakeSend.mock.calls[0][0];
    expect(opts.to).toBe('parent@example.com');
    expect(opts.subject).toBe(CREDENTIALS_EMAIL_SUBJECT);
    expect(opts.text).toContain('Hi Alice Liddell,');
    expect(opts.text).toContain('Username: alice');
    expect(opts.text).toContain('Password: purple-cactus-river');
    expect(opts.text).toContain('Sign in at https://accounts.jointheleague.org');
    expect(opts.text).toContain(LAPTOP_LOGIN_LINE);
    expect(opts.text).toContain('See you Tuesday.');
    expect(opts.html).toContain('Username: alice');
    expect(opts.html).toContain('purple-cactus-river');

    const events = await auditEvents('credentials_emailed');
    expect(events).toHaveLength(1);
    expect(events[0].actor_user_id).toBe(adminId);
    expect(events[0].target_user_id).toBe(user.id);
    expect(events[0].details).toMatchObject({ to: 'parent@example.com', included_password: true });
    expect(JSON.stringify(events)).not.toContain('purple-cactus-river');
  });

  it('omits the password line when none is supplied and the laptop line when the flag is off', async () => {
    const user = await makeUser({
      display_name: 'Bob',
      username: 'bob',
      password_hash: 'a:b',
      laptop_password_hash: '$6$x$y',
      allows_laptop_account: false,
    });
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.post(`/api/admin/users/${user.id}/credentials/email`).send({ to: 'bob@example.com' });

    expect(res.status).toBe(200);
    const opts = fakeSend.mock.calls[0][0];
    expect(opts.text).toContain('Username: bob');
    expect(opts.text).not.toMatch(/Password:/);
    expect(opts.text).not.toContain(LAPTOP_LOGIN_LINE);
    const events = await auditEvents('credentials_emailed');
    expect(events[0].details).toMatchObject({ included_password: false });
  });

  it('omits the laptop line when the user has no laptop hash yet (no roster entry would exist)', async () => {
    const user = await makeUser({ username: 'carol', password_hash: null, laptop_password_hash: null });
    const { agent } = await loginAs('admin@example.com');

    await agent.post(`/api/admin/users/${user.id}/credentials/email`).send({ to: 'carol@example.com' }).expect(200);

    expect(fakeSend.mock.calls[0][0].text).not.toContain(LAPTOP_LOGIN_LINE);
  });

  it('tells a user without a username to sign in with their email', async () => {
    const user = await makeUser({ primary_email: 'dave@example.com' });
    const { agent } = await loginAs('admin@example.com');

    await agent
      .post(`/api/admin/users/${user.id}/credentials/email`)
      .send({ to: 'dave@example.com', password: 'river-maple-seven' })
      .expect(200);

    const text = fakeSend.mock.calls[0][0].text;
    expect(text).toContain('Sign in with your email address: dave@example.com');
    expect(text).not.toMatch(/Username:/);
    expect(text).toContain('Password: river-maple-seven');
  });

  it('refuses a .invalid recipient and a malformed address without sending', async () => {
    const user = await eligibleUser();
    const { agent } = await loginAs('admin@example.com');

    const invalid = await agent
      .post(`/api/admin/users/${user.id}/credentials/email`)
      .send({ to: 'alice@laptop.invalid' });
    expect(invalid.status).toBe(400);
    expect(invalid.body.error).toMatch(/\.invalid/);

    for (const bad of ['', 'not-an-email', 'a@b', 'has space@example.com', 42, undefined]) {
      const res = await agent.post(`/api/admin/users/${user.id}/credentials/email`).send({ to: bad });
      expect(res.status, String(bad)).toBe(400);
    }

    expect(fakeSend).not.toHaveBeenCalled();
    expect(await auditEvents('credentials_emailed')).toHaveLength(0);
  });

  it('returns 400 when SMTP is not configured', async () => {
    const user = await eligibleUser();
    fakeMail.isConfigured.mockReturnValue(false);
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.post(`/api/admin/users/${user.id}/credentials/email`).send({ to: 'parent@example.com' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/SMTP not configured/i);
    expect(fakeSend).not.toHaveBeenCalled();
  });

  it("passes the mail service's skipped result through and does not audit a send", async () => {
    const user = await eligibleUser();
    fakeSend.mockResolvedValue({ skipped: true, reason: 'undeliverable .invalid recipient' });
    const { agent } = await loginAs('admin@example.com');

    const res = await agent.post(`/api/admin/users/${user.id}/credentials/email`).send({ to: 'parent@example.com' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ sent: false, skipped: true, reason: 'undeliverable .invalid recipient' });
    expect(await auditEvents('credentials_emailed')).toHaveLength(0);
  });
});
