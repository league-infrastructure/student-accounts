/**
 * Sprint 007 scenario tests — T007.
 *
 * End-to-end integration tests for the full merge workflow:
 *   MergeScanService (with FakeHaikuClient) → MergeSuggestion creation
 *   → admin queue routes → approve / reject / defer actions.
 *
 * These tests use a real SQLite test database, a FakeHaikuClient to avoid
 * network calls, and supertest for HTTP assertions.
 *
 * COVERAGE provided here:
 *
 *  Scenario 1: mergeScan with high confidence (0.8) → MergeSuggestion created.
 *    Seeds two similar users, calls mergeScanWithDeps with FakeHaikuClient
 *    configured to return confidence 0.8, asserts a MergeSuggestion row is
 *    created with status=pending and the correct haiku_confidence value.
 *
 *  Scenario 2: mergeScan with low confidence (0.4) → no MergeSuggestion created.
 *    Same setup but FakeHaikuClient returns confidence 0.4 (below threshold),
 *    asserts no MergeSuggestion row is written to the database.
 *
 *  Scenario 3: GET /api/admin/merge-queue returns queue items.
 *    Seeds a MergeSuggestion row directly, asserts the GET endpoint returns it
 *    with the expected user summaries.
 *
 *  Scenario 4: GET /api/admin/merge-queue/:id returns full suggestion detail.
 *    Seeds a suggestion with Logins and ExternalAccounts on both users, asserts
 *    the detail endpoint includes user logins and external_accounts arrays.
 *
 *  Scenario 5: POST /api/admin/merge-queue/:id/approve — full end-to-end merge.
 *    Seeds two users (with Logins and an ExternalAccount on the non-survivor),
 *    approves the suggestion with the survivor's id, asserts: non-survivor has
 *    is_active=false, logins re-parented, external_accounts re-parented, suggestion
 *    status=approved, merge_approve audit event written.
 *
 *  Scenario 6: POST approve — already-approved suggestion → 409.
 *    Attempts to approve a suggestion already in approved state, verifying that
 *    the route returns 409 (MergeConflictError) and both users remain untouched.
 *
 *  Scenario 7: POST /api/admin/merge-queue/:id/reject → status=rejected.
 *    Asserts merge_reject audit event written; both users remain intact.
 *
 *  Scenario 8: POST /api/admin/merge-queue/:id/defer → status=deferred.
 *    Asserts the suggestion still appears in GET /api/admin/merge-queue (deferred
 *    suggestions are included in the queue).
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { mergeScanWithDeps } from '../../../server/src/services/auth/merge-scan.service.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { FakeHaikuClient } from '../helpers/fake-haiku.client.js';
import {
  makeUser,
  makeLogin,
  makeExternalAccount,
  makeMergeSuggestion,
} from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

/**
 * Create a supertest agent with an active admin session.
 */
async function loginAsAdmin(email: string): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/test-login').send({ email, role: 'admin' });
  if (res.status !== 200) {
    throw new Error(`test-login failed for ${email}: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return agent;
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
});

// ===========================================================================
// Scenario 1: mergeScan high confidence → MergeSuggestion created
// ===========================================================================

describe('Scenario 1 (T007): mergeScan with confidence 0.8 → MergeSuggestion row created', () => {
  it('creates a pending MergeSuggestion with haiku_confidence=0.8', async () => {
    const userA = await makeUser({
      display_name: 'Alice Smith',
      primary_email: 'alice.smith@example.com',
      role: 'student',
    });
    const userB = await makeUser({
      display_name: 'Alice M Smith',
      primary_email: 'alicesmith@example.com',
      role: 'student',
    });

    const fake = new FakeHaikuClient();
    fake.configure({ confidence: 0.8, rationale: 'Very similar name and email pattern.' });

    const audit = new AuditService();
    await mergeScanWithDeps(userB, prisma, fake, audit);

    const suggestions = await (prisma as any).mergeSuggestion.findMany();
    expect(suggestions).toHaveLength(1);

    const suggestion = suggestions[0];
    expect(suggestion.status).toBe('pending');
    expect(suggestion.haiku_confidence).toBeCloseTo(0.8, 5);
    expect(suggestion.haiku_rationale).toBe('Very similar name and email pattern.');

    // Pair order is canonicalised: lower id → user_a_id
    const expectedAId = Math.min(userA.id, userB.id);
    const expectedBId = Math.max(userA.id, userB.id);
    expect(suggestion.user_a_id).toBe(expectedAId);
    expect(suggestion.user_b_id).toBe(expectedBId);

    // FakeHaikuClient was called once
    expect(fake.calls).toHaveLength(1);
  });
});

// ===========================================================================
// Scenario 2: mergeScan low confidence → no MergeSuggestion created
// ===========================================================================

describe('Scenario 2 (T007): mergeScan with confidence 0.4 → no MergeSuggestion row', () => {
  it('does not create a MergeSuggestion when confidence is below threshold', async () => {
    await makeUser({
      display_name: 'Bob Jones',
      primary_email: 'bob.jones@example.com',
      role: 'student',
    });
    const userB = await makeUser({
      display_name: 'Carol White',
      primary_email: 'carol.white@example.com',
      role: 'student',
    });

    const fake = new FakeHaikuClient();
    fake.configure({ confidence: 0.4, rationale: 'Different name and email.' });

    const audit = new AuditService();
    await mergeScanWithDeps(userB, prisma, fake, audit);

    const suggestions = await (prisma as any).mergeSuggestion.findMany();
    expect(suggestions).toHaveLength(0);

    // FakeHaikuClient was still called (threshold check happens after evaluate)
    expect(fake.calls).toHaveLength(1);
  });
});

// ===========================================================================
// Scenario 3: GET /api/admin/merge-queue returns queue items
// ===========================================================================

describe('Scenario 3 (T007): GET /api/admin/merge-queue returns pending suggestions', () => {
  it('returns the seeded suggestion with user summaries', async () => {
    await makeUser({ primary_email: 'admin-s3@example.com', role: 'admin' });
    const userA = await makeUser({
      display_name: 'Dave Allen',
      primary_email: 'dave.allen@example.com',
      role: 'student',
    });
    const userB = await makeUser({
      display_name: 'David Allen',
      primary_email: 'davidallen@example.com',
      role: 'student',
    });
    await makeMergeSuggestion(userA, userB, {
      haiku_confidence: 0.85,
      haiku_rationale: 'Same name, different email format.',
      status: 'pending',
    });

    const agent = await loginAsAdmin('admin-s3@example.com');
    const res = await agent.get('/api/admin/merge-queue');

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body).toHaveLength(1);

    const item = res.body[0];
    expect(item.status).toBe('pending');
    expect(item.haiku_confidence).toBeCloseTo(0.85, 4);
    expect(item.user_a).toBeDefined();
    expect(item.user_b).toBeDefined();
    // user summaries should include id, display_name, primary_email
    const ids = [item.user_a.id, item.user_b.id];
    expect(ids).toContain(userA.id);
    expect(ids).toContain(userB.id);
  });
});

// ===========================================================================
// Scenario 4: GET /api/admin/merge-queue/:id returns full detail
// ===========================================================================

describe('Scenario 4 (T007): GET /api/admin/merge-queue/:id returns detail with Logins and ExternalAccounts', () => {
  it('returns full suggestion detail including user logins and external_accounts', async () => {
    await makeUser({ primary_email: 'admin-s4@example.com', role: 'admin' });
    const userA = await makeUser({
      display_name: 'Eve Green',
      primary_email: 'eve.green@example.com',
      role: 'student',
    });
    const userB = await makeUser({
      display_name: 'Eva Green',
      primary_email: 'evagreen@example.com',
      role: 'student',
    });
    await makeLogin(userA, { provider: 'google', provider_email: 'eve.green@gmail.com' });
    await makeExternalAccount(userB, { type: 'workspace', status: 'active' });

    const suggestion = await makeMergeSuggestion(userA, userB, {
      haiku_confidence: 0.9,
      status: 'pending',
    });

    const agent = await loginAsAdmin('admin-s4@example.com');
    const res = await agent.get(`/api/admin/merge-queue/${suggestion.id}`);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(suggestion.id);
    expect(res.body.status).toBe('pending');

    // Both user objects should be present
    expect(res.body.user_a).toBeDefined();
    expect(res.body.user_b).toBeDefined();

    // Logins and ExternalAccounts arrays should be present
    const userABody = [res.body.user_a, res.body.user_b].find((u: any) => u.id === userA.id);
    const userBBody = [res.body.user_a, res.body.user_b].find((u: any) => u.id === userB.id);
    expect(userABody).toBeDefined();
    expect(userBBody).toBeDefined();
    expect(Array.isArray(userABody.logins)).toBe(true);
    expect(userABody.logins).toHaveLength(1);
    expect(userABody.logins[0].provider).toBe('google');
    expect(Array.isArray(userBBody.external_accounts)).toBe(true);
    expect(userBBody.external_accounts).toHaveLength(1);
    expect(userBBody.external_accounts[0].type).toBe('workspace');
  });
});

// ===========================================================================
// Scenario 5: POST approve — full end-to-end merge
// ===========================================================================

describe('Scenario 5 (T007): POST /api/admin/merge-queue/:id/approve → full merge', () => {
  it('deactivates non-survivor, re-parents Logins and ExternalAccounts, records audit event', async () => {
    const admin = await makeUser({ primary_email: 'admin-s5@example.com', role: 'admin' });
    const survivor = await makeUser({
      display_name: 'Frank Brown',
      primary_email: 'frank.brown@example.com',
      role: 'student',
    });
    const nonSurvivor = await makeUser({
      display_name: 'Franklin Brown',
      primary_email: 'franklinbrown@example.com',
      role: 'student',
    });

    // Non-survivor has a Login and an ExternalAccount — both should be re-parented
    const nonSurvivorLogin = await makeLogin(nonSurvivor, { provider: 'github' });
    const nonSurvivorAccount = await makeExternalAccount(nonSurvivor, {
      type: 'workspace',
      status: 'active',
    });

    const suggestion = await makeMergeSuggestion(survivor, nonSurvivor, {
      haiku_confidence: 0.92,
      status: 'pending',
    });

    const agent = await loginAsAdmin('admin-s5@example.com');
    const res = await agent
      .post(`/api/admin/merge-queue/${suggestion.id}/approve`)
      .send({ survivorId: survivor.id });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Non-survivor is now inactive
    const dbNonSurvivor = await (prisma as any).user.findUnique({ where: { id: nonSurvivor.id } });
    expect(dbNonSurvivor.is_active).toBe(false);

    // Survivor is still active
    const dbSurvivor = await (prisma as any).user.findUnique({ where: { id: survivor.id } });
    expect(dbSurvivor.is_active).toBe(true);

    // Login re-parented to survivor
    const dbLogin = await (prisma as any).login.findUnique({ where: { id: nonSurvivorLogin.id } });
    expect(dbLogin.user_id).toBe(survivor.id);

    // ExternalAccount re-parented to survivor
    const dbAccount = await (prisma as any).externalAccount.findUnique({
      where: { id: nonSurvivorAccount.id },
    });
    expect(dbAccount.user_id).toBe(survivor.id);

    // Suggestion status = approved
    const dbSuggestion = await (prisma as any).mergeSuggestion.findUnique({
      where: { id: suggestion.id },
    });
    expect(dbSuggestion.status).toBe('approved');
    expect(dbSuggestion.decided_by).toBe(admin.id);
    expect(dbSuggestion.decided_at).not.toBeNull();

    // merge_approve audit event recorded
    const auditEvents = await (prisma as any).auditEvent.findMany({
      where: { action: 'merge_approve' },
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].actor_user_id).toBe(admin.id);
    expect(auditEvents[0].target_user_id).toBe(survivor.id);
  });
});

// ===========================================================================
// Scenario 6: POST approve — already-approved suggestion → 409, both users intact
// ===========================================================================

describe('Scenario 6 (T007): POST approve — already-approved suggestion → 409, both users intact', () => {
  it('returns 409 when suggestion is already approved, and does not alter user state', async () => {
    const admin = await makeUser({ primary_email: 'admin-s6@example.com', role: 'admin' });
    const survivor = await makeUser({
      display_name: 'Grace Kim',
      primary_email: 'grace.kim@example.com',
      role: 'student',
    });
    const nonSurvivor = await makeUser({
      display_name: 'Grace K',
      primary_email: 'gracek@example.com',
      role: 'student',
    });

    // Pre-seed an already-approved suggestion. non-survivor is already deactivated
    // as would happen after a real approve. The approve endpoint must reject a
    // second action on a terminal suggestion.
    const suggestion = await makeMergeSuggestion(survivor, nonSurvivor, {
      haiku_confidence: 0.88,
      status: 'approved',
      decided_by: admin.id,
      decided_at: new Date(),
    });

    const agent = await loginAsAdmin('admin-s6@example.com');
    const res = await agent
      .post(`/api/admin/merge-queue/${suggestion.id}/approve`)
      .send({ survivorId: survivor.id });

    // Already-approved suggestion returns 409 MergeConflictError
    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();

    // Both users remain untouched — the route must not modify them
    const dbSurvivor = await (prisma as any).user.findUnique({ where: { id: survivor.id } });
    const dbNonSurvivor = await (prisma as any).user.findUnique({ where: { id: nonSurvivor.id } });
    expect(dbSurvivor.is_active).toBe(true);
    expect(dbNonSurvivor.is_active).toBe(true);

    // Suggestion remains approved (not double-mutated)
    const dbSuggestion = await (prisma as any).mergeSuggestion.findUnique({
      where: { id: suggestion.id },
    });
    expect(dbSuggestion.status).toBe('approved');
  });
});

// ===========================================================================
// Scenario 7: POST reject → status=rejected
// ===========================================================================

describe('Scenario 7 (T007): POST /api/admin/merge-queue/:id/reject → suggestion rejected', () => {
  it('sets status=rejected and writes merge_reject audit event', async () => {
    const admin = await makeUser({ primary_email: 'admin-s7@example.com', role: 'admin' });
    const userA = await makeUser({
      display_name: 'Henry Ford',
      primary_email: 'henry.ford@example.com',
      role: 'student',
    });
    const userB = await makeUser({
      display_name: 'Henri Ford',
      primary_email: 'henriford@example.com',
      role: 'student',
    });

    const suggestion = await makeMergeSuggestion(userA, userB, {
      haiku_confidence: 0.7,
      status: 'pending',
    });

    const agent = await loginAsAdmin('admin-s7@example.com');
    const res = await agent.post(`/api/admin/merge-queue/${suggestion.id}/reject`);

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    // Suggestion is now rejected
    const dbSuggestion = await (prisma as any).mergeSuggestion.findUnique({
      where: { id: suggestion.id },
    });
    expect(dbSuggestion.status).toBe('rejected');
    expect(dbSuggestion.decided_by).toBe(admin.id);
    expect(dbSuggestion.decided_at).not.toBeNull();

    // Both users remain active and untouched
    const dbUserA = await (prisma as any).user.findUnique({ where: { id: userA.id } });
    const dbUserB = await (prisma as any).user.findUnique({ where: { id: userB.id } });
    expect(dbUserA.is_active).toBe(true);
    expect(dbUserB.is_active).toBe(true);

    // merge_reject audit event recorded
    const auditEvents = await (prisma as any).auditEvent.findMany({
      where: { action: 'merge_reject' },
    });
    expect(auditEvents).toHaveLength(1);
    expect(auditEvents[0].actor_user_id).toBe(admin.id);
  });
});

// ===========================================================================
// Scenario 8: POST defer → status=deferred, still appears in GET queue
// ===========================================================================

describe('Scenario 8 (T007): POST /api/admin/merge-queue/:id/defer → deferred; still in queue', () => {
  it('sets status=deferred and suggestion still appears in GET /api/admin/merge-queue', async () => {
    await makeUser({ primary_email: 'admin-s8@example.com', role: 'admin' });
    const userA = await makeUser({
      display_name: 'Iris Park',
      primary_email: 'iris.park@example.com',
      role: 'student',
    });
    const userB = await makeUser({
      display_name: 'Irene Park',
      primary_email: 'irenepark@example.com',
      role: 'student',
    });

    const suggestion = await makeMergeSuggestion(userA, userB, {
      haiku_confidence: 0.65,
      status: 'pending',
    });

    const agent = await loginAsAdmin('admin-s8@example.com');

    // Defer the suggestion
    const deferRes = await agent.post(`/api/admin/merge-queue/${suggestion.id}/defer`);
    expect(deferRes.status).toBe(200);
    expect(deferRes.body.ok).toBe(true);

    // Suggestion is now deferred
    const dbSuggestion = await (prisma as any).mergeSuggestion.findUnique({
      where: { id: suggestion.id },
    });
    expect(dbSuggestion.status).toBe('deferred');
    // defer does not set decided_by or decided_at
    expect(dbSuggestion.decided_by).toBeNull();
    expect(dbSuggestion.decided_at).toBeNull();

    // The deferred suggestion still appears in GET /api/admin/merge-queue
    const listRes = await agent.get('/api/admin/merge-queue');
    expect(listRes.status).toBe(200);
    expect(Array.isArray(listRes.body)).toBe(true);
    const ids = listRes.body.map((item: any) => item.id);
    expect(ids).toContain(suggestion.id);

    const itemInQueue = listRes.body.find((item: any) => item.id === suggestion.id);
    expect(itemInQueue.status).toBe('deferred');
  });
});
