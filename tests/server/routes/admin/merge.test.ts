/**
 * Integration tests for the admin manual merge and rule-scan backfill routes
 * (sprint 002 "laptop accounts" T008, SUC-005).
 *
 *  POST /api/admin/users/:id/merge { otherUserId, survivorId }
 *    - 401 unauthenticated, 403 student
 *    - 400 bad id / non-numeric body / survivor neither / same user
 *    - 404 unknown user
 *    - 409 either user inactive, pair already merged
 *    - 200 { ok: true, survivorId }: admin-initiated suggestion approved,
 *      everything moved, roster reconciled for both users
 *  POST /api/admin/merge-queue/rescan
 *    - 401 / 403; 200 { scanned, created }, no LLM involved
 *  GET /api/admin/merge-queue/:id carries the T008 fields.
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { LaptopAccountService } from '../../../../server/src/services/laptop/laptop-account.service.js';
import { MergeSuggestionService } from '../../../../server/src/services/merge-suggestion.service.js';
import { FakeLaptopRosterClient } from '../../helpers/fake-laptop-roster.client.js';
import { makeUser, makeGroup, makeMembership, makeMergeSuggestion } from '../../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../../server/src/app.js';

const HASH = '$6$rounds=5000$saltsalt$Qm4v1gG6k1WJ0b0w0vXk7y9xO3bX5Yd8m3dN6l2kH9pR1sT4uV7wX0yZ2aB5cD8eF1gH4iJ7kL0mN3oP6q';

const original = {
  laptopRoster: registry.laptopRoster,
  laptopAccounts: registry.laptopAccounts,
  mergeSuggestions: registry.mergeSuggestions,
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

beforeEach(async () => {
  await cleanDb();
  roster = new FakeLaptopRosterClient();
  const laptopAccounts = new LaptopAccountService(roster, prisma as any, registry.audit);
  (registry as any).laptopRoster = roster;
  (registry as any).laptopAccounts = laptopAccounts;
  (registry as any).mergeSuggestions = new MergeSuggestionService(prisma as any, registry.audit, laptopAccounts);
});

afterAll(async () => {
  (registry as any).laptopRoster = original.laptopRoster;
  (registry as any).laptopAccounts = original.laptopAccounts;
  (registry as any).mergeSuggestions = original.mergeSuggestions;
  await cleanDb();
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/merge — auth
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/merge — auth', () => {
  it('returns 401 when not authenticated', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const res = await request(app)
      .post(`/api/admin/users/${a.id}/merge`)
      .send({ otherUserId: b.id, survivorId: a.id });
    expect(res.status).toBe(401);
  });

  it('returns 403 for a student', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { agent } = await loginAs('student-merge@example.com', 'student');
    const res = await agent
      .post(`/api/admin/users/${a.id}/merge`)
      .send({ otherUserId: b.id, survivorId: a.id });
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/merge — validation
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/merge — validation', () => {
  it('returns 400 for a bad user id or a non-numeric body', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const { agent } = await loginAs('admin-merge-400@example.com');

    expect((await agent.post('/api/admin/users/abc/merge').send({ otherUserId: b.id, survivorId: a.id })).status).toBe(400);
    expect((await agent.post(`/api/admin/users/${a.id}/merge`).send({ otherUserId: String(b.id), survivorId: a.id })).status).toBe(400);
    expect((await agent.post(`/api/admin/users/${a.id}/merge`).send({ otherUserId: b.id })).status).toBe(400);
    expect((await agent.post(`/api/admin/users/${a.id}/merge`).send({})).status).toBe(400);
  });

  it('returns 400 when the survivor is neither user', async () => {
    const a = await makeUser();
    const b = await makeUser();
    const c = await makeUser();
    const { agent } = await loginAs('admin-merge-neither@example.com');
    const res = await agent
      .post(`/api/admin/users/${a.id}/merge`)
      .send({ otherUserId: b.id, survivorId: c.id });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/neither/);
  });

  it('returns 400 when merging a user with itself', async () => {
    const a = await makeUser();
    const { agent } = await loginAs('admin-merge-self@example.com');
    const res = await agent
      .post(`/api/admin/users/${a.id}/merge`)
      .send({ otherUserId: a.id, survivorId: a.id });
    expect(res.status).toBe(400);
  });

  it('returns 404 when either user is unknown', async () => {
    const a = await makeUser();
    const { agent } = await loginAs('admin-merge-404@example.com');
    expect((await agent.post(`/api/admin/users/${a.id}/merge`).send({ otherUserId: 999_999, survivorId: a.id })).status).toBe(404);
    expect((await agent.post('/api/admin/users/999999/merge').send({ otherUserId: a.id, survivorId: a.id })).status).toBe(404);
  });

  it('returns 409 when either user is inactive', async () => {
    const a = await makeUser();
    const inactive = await makeUser({ is_active: false });
    const { agent } = await loginAs('admin-merge-409@example.com');
    expect((await agent.post(`/api/admin/users/${a.id}/merge`).send({ otherUserId: inactive.id, survivorId: a.id })).status).toBe(409);
    expect((await agent.post(`/api/admin/users/${inactive.id}/merge`).send({ otherUserId: a.id, survivorId: a.id })).status).toBe(409);
    // Nothing changed.
    expect((await (prisma as any).user.findUniqueOrThrow({ where: { id: a.id } })).is_active).toBe(true);
    expect(await (prisma as any).mergeSuggestion.count()).toBe(0);
  });

  it('returns 409 when the pair was already merged', async () => {
    const a = await makeUser();
    const b = await makeUser();
    await makeMergeSuggestion(a, b, { status: 'approved' });
    const { agent } = await loginAs('admin-merge-done@example.com');
    const res = await agent
      .post(`/api/admin/users/${a.id}/merge`)
      .send({ otherUserId: b.id, survivorId: a.id });
    expect(res.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/users/:id/merge — success
// ---------------------------------------------------------------------------

describe('POST /api/admin/users/:id/merge — success', () => {
  it('merges a laptop-imported user into a Google user and re-points the roster', async () => {
    const google = await makeUser({ primary_email: 'alice@gmail.com', display_name: 'Alice Smith' });
    const laptop = await makeUser({
      username: 'alice',
      primary_email: 'alice@laptop.invalid',
      display_name: 'alice',
      password_hash: HASH,
      laptop_password_hash: HASH,
      created_via: 'laptop_import' as any,
    });
    roster.seed({
      id: 'alice', display_name: 'alice', password_hash: HASH,
      created: '20260825T170542Z', created_host: 'jtl-inspiron-ABC123',
    });
    const group = await makeGroup({ name: 'Botball 26' });
    await makeMembership(group, laptop);
    const { agent, id: adminId } = await loginAs('admin-merge-ok@example.com');

    const res = await agent
      .post(`/api/admin/users/${google.id}/merge`)
      .send({ otherUserId: laptop.id, survivorId: google.id });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ ok: true, survivorId: google.id });

    const survivor = await (prisma as any).user.findUniqueOrThrow({ where: { id: google.id } });
    expect(survivor.username).toBe('alice');
    expect(survivor.laptop_password_hash).toBe(HASH);
    expect(survivor.is_active).toBe(true);
    const gone = await (prisma as any).user.findUniqueOrThrow({ where: { id: laptop.id } });
    expect(gone.is_active).toBe(false);
    expect(gone.primary_email).toBe(`merged:${google.id}:alice@laptop.invalid`);
    expect(gone.username).toBeNull();

    expect(await (prisma as any).userGroup.count({ where: { user_id: google.id, group_id: group.id } })).toBe(1);

    const suggestion = await (prisma as any).mergeSuggestion.findFirst();
    expect(suggestion).toMatchObject({
      status: 'approved',
      haiku_rationale: 'admin-initiated',
      haiku_confidence: 1.0,
      decided_by: adminId,
    });

    // Roster: the survivor now owns "alice" (display name updated, created preserved).
    const entry = await roster.read('alice');
    expect(entry).not.toBeNull();
    expect(entry!.password_hash).toBe(HASH);
    expect(entry!.display_name).toBe('Alice Smith');
    expect(entry!.created).toBe('20260825T170542Z');

    const approve = await (prisma as any).auditEvent.findMany({ where: { action: 'merge_approve' } });
    expect(approve).toHaveLength(1);
    expect(approve[0].actor_user_id).toBe(adminId);
    expect(approve[0].details.username).toEqual({ taken: 'alice' });
    expect(approve[0].details.groups_moved).toEqual(['Botball 26']);
  });

  it('locks the dropped username roster entry when both users have a username', async () => {
    const keep = await makeUser({ username: 'alice', password_hash: HASH, laptop_password_hash: HASH });
    const drop = await makeUser({ username: 'bob', password_hash: HASH, laptop_password_hash: HASH });
    roster.seed({ id: 'alice', display_name: 'Alice', password_hash: HASH, created: '20260101T000000Z', created_host: 'h' });
    roster.seed({ id: 'bob', display_name: 'Bob', password_hash: HASH, created: '20260101T000000Z', created_host: 'h' });
    const { agent } = await loginAs('admin-merge-lock@example.com');

    const res = await agent
      .post(`/api/admin/users/${drop.id}/merge`)
      .send({ otherUserId: keep.id, survivorId: keep.id });
    expect(res.status).toBe(200);

    expect((await roster.read('bob'))!.password_hash).toBe('!');
    expect((await roster.read('alice'))!.password_hash).toBe(HASH);
    const approve = await (prisma as any).auditEvent.findFirst({ where: { action: 'merge_approve' } });
    expect(approve.details.username).toEqual({ dropped: 'bob', kept: 'alice' });
  });
});

// ---------------------------------------------------------------------------
// POST /api/admin/merge-queue/rescan
// ---------------------------------------------------------------------------

describe('POST /api/admin/merge-queue/rescan', () => {
  it('returns 401 / 403 without an admin session', async () => {
    expect((await request(app).post('/api/admin/merge-queue/rescan')).status).toBe(401);
    const { agent } = await loginAs('student-rescan@example.com', 'student');
    expect((await agent.post('/api/admin/merge-queue/rescan')).status).toBe(403);
  });

  it('creates rule-based suggestions for laptop-imported users and reports counts', async () => {
    const google = await makeUser({ primary_email: 'carol@gmail.com', display_name: 'Carol Lee' });
    const imported = await makeUser({
      username: 'carol', primary_email: 'carol@laptop.invalid', display_name: 'carol', created_via: 'laptop_import' as any,
    });
    await makeUser({
      username: 'dan', primary_email: 'dan@laptop.invalid', display_name: 'dan', created_via: 'laptop_import' as any,
    });
    const { agent } = await loginAs('admin-rescan@example.com');

    const res = await agent.post('/api/admin/merge-queue/rescan');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ scanned: 2, created: 1 });

    const queue = await agent.get('/api/admin/merge-queue');
    expect(queue.body).toHaveLength(1);
    expect(queue.body[0]).toMatchObject({
      haiku_confidence: 1,
      haiku_rationale: 'same username as email local part',
      status: 'pending',
    });
    expect([queue.body[0].user_a.id, queue.body[0].user_b.id].sort()).toEqual([google.id, imported.id].sort());

    const again = await agent.post('/api/admin/merge-queue/rescan');
    expect(again.body).toEqual({ scanned: 2, created: 0 });
  });
});

// ---------------------------------------------------------------------------
// GET /api/admin/merge-queue/:id — T008 fields
// ---------------------------------------------------------------------------

describe('GET /api/admin/merge-queue/:id — T008 fields', () => {
  it('carries username, created_via, created_host, token summary and group names per user', async () => {
    const google = await makeUser({ primary_email: 'erin@gmail.com', display_name: 'Erin Fox' });
    const imported = await makeUser({
      username: 'erin', primary_email: 'erin@laptop.invalid', display_name: 'erin', created_via: 'laptop_import' as any,
    });
    await (prisma as any).login.create({
      data: {
        user_id: imported.id,
        provider: 'username',
        provider_user_id: 'laptop-import:erin',
        provider_username: 'erin',
        provider_payload: { created: '20260825T170542Z', created_host: 'jtl-inspiron-XYZ' },
      },
    });
    await (prisma as any).llmProxyToken.create({
      data: {
        user_id: google.id,
        token_hash: `h-${Date.now()}`,
        token_plaintext: 'llmp_x',
        expires_at: new Date(Date.now() + 86_400_000),
        token_limit: 50_000,
        tokens_used: 321,
      },
    });
    const group = await makeGroup({ name: 'Botball 26' });
    await makeMembership(group, imported);
    const s = await makeMergeSuggestion(google, imported);
    const { agent } = await loginAs('admin-detail-t008@example.com');

    const res = await agent.get(`/api/admin/merge-queue/${s.id}`);
    expect(res.status).toBe(200);
    expect(res.body.user_a).toMatchObject({
      id: google.id,
      username: null,
      created_via: 'admin_created',
      created_host: null,
      llm_proxy_token: { tokens_used: 321, token_limit: 50_000 },
      groups: [],
    });
    expect(res.body.user_b).toMatchObject({
      id: imported.id,
      username: 'erin',
      created_via: 'laptop_import',
      created_host: 'jtl-inspiron-XYZ',
      llm_proxy_token: null,
      groups: ['Botball 26'],
    });
  });
});
