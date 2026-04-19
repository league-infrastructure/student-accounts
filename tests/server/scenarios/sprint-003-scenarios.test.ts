/**
 * Sprint 003 scenario tests — T008.
 *
 * These tests cover NARRATIVE flows that cross multiple endpoints in sequence,
 * filling gaps not addressed by the individual route/service tests in T002–T007.
 *
 * COVERAGE AUDIT — what is already covered and therefore NOT repeated here:
 *
 *  - UC-011 individual steps (DELETE 204, DELETE 409 last-login guard, cross-user
 *    scope 404, unauthenticated 401, staff/admin 403, session survives removal,
 *    audit event recorded):
 *    → COVERED: tests/server/routes/account.test.ts
 *
 *  - UC-007 individual steps (POST workspace 201, POST duplicate 409,
 *    POST workspace_and_claude creates two rows, POST claude-only without
 *    workspace 422, POST claude-only with active workspace 201, invalid
 *    requestType 400, unauthenticated 401, staff 403, GET list):
 *    → COVERED: tests/server/routes/account.test.ts
 *
 *  - Cross-user scope guard (DELETE login of another user → 404):
 *    → COVERED: tests/server/routes/account.test.ts — "cross-user scope guard"
 *
 *  - Role guards (GET/POST/DELETE /api/account/* with staff or admin → 403):
 *    → COVERED: tests/server/routes/account.test.ts (multiple describe blocks)
 *
 *  - Unauthenticated → 401 on all three endpoints:
 *    → COVERED: tests/server/routes/account.test.ts
 *
 *  - Link-mode OAuth (GET /api/auth/google?link=1 → sets session.link,
 *    callback creates Login, audit, idempotent re-link, conflict):
 *    → COVERED: tests/server/routes/auth.link.test.ts
 *
 *  - Auth session lifecycle (sign-in → logout → 401):
 *    → COVERED: tests/server/auth-flows.integration.test.ts
 *
 * NEW SCENARIOS ADDED HERE (not covered by prior tests):
 *
 *  Scenario A: UC-011 narrative — multi-step GET-then-DELETE sequence.
 *    The prior tests verify DELETE and GET independently. This scenario verifies
 *    the intermediate GET state between two deletions in a single narrative flow.
 *
 *  Scenario B: UC-007 narrative — POST workspace, verify GET /api/account
 *    reflects it, then POST again → 409. Tests that GET /api/account shows the
 *    newly created request (the two operations together as a story, not split).
 *
 *  Scenario C: UC-007 constraint narrative — POST workspace, then POST
 *    workspace_and_claude → 409 (duplicate workspace). This specific sequence
 *    (workspace pending → workspace_and_claude attempt) is NOT in account.test.ts.
 *
 *  Scenario D: Cross-user data isolation on GET /api/account.
 *    Two students sign in concurrently (two agents). Each agent's GET /api/account
 *    must return only their own data even though both sessions are active.
 *    The prior test creates two users but only runs one agent.
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import {
  makeUser,
  makeLogin,
  makeProvisioningRequest,
} from '../helpers/factories.js';

process.env.NODE_ENV = 'test';

import app from '../../../server/src/app.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

/**
 * Create a supertest agent and sign in via the test-login shortcut.
 */
async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'student',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/test-login').send({ email, role });
  if (res.status !== 200) {
    throw new Error(`test-login failed for ${email}: ${res.status}`);
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

// ---------------------------------------------------------------------------
// Scenario A: UC-011 narrative — two-step removal with GET verification
//
// Flow:
//   1. User has two logins (google + github).
//   2. DELETE first login → 204.
//   3. GET /api/account → response logins array contains only the second login.
//   4. DELETE second (remaining) login → 409 (last-login guard).
//
// This scenario is NOT split across independent tests — it drives a single
// agent through all four steps in order to verify the intermediate GET state.
// ---------------------------------------------------------------------------

describe('Scenario A: UC-011 full narrative — delete, verify GET, blocked on last', () => {
  it('removes first login, GET reflects state, blocks removal of last login', async () => {
    // Setup
    const user = await makeUser({
      primary_email: 'uc011-narrative@example.com',
      role: 'student',
    });
    const loginGoogle = await makeLogin(user, { provider: 'google' });
    const loginGithub = await makeLogin(user, { provider: 'github' });

    const agent = await loginAs('uc011-narrative@example.com');

    // Step 1: GET /api/account shows two logins
    const before = await agent.get('/api/account');
    expect(before.status).toBe(200);
    expect(before.body.logins).toHaveLength(2);
    const loginIds: number[] = before.body.logins.map((l: any) => l.id).sort((a: number, b: number) => a - b);
    expect(loginIds).toContain(loginGoogle.id);
    expect(loginIds).toContain(loginGithub.id);

    // Step 2: DELETE the google login → 204
    const deleteRes = await agent.delete(`/api/account/logins/${loginGoogle.id}`);
    expect(deleteRes.status).toBe(204);

    // Step 3: GET /api/account → only the github login remains
    const mid = await agent.get('/api/account');
    expect(mid.status).toBe(200);
    expect(mid.body.logins).toHaveLength(1);
    expect(mid.body.logins[0].provider).toBe('github');
    expect(mid.body.logins[0].id).toBe(loginGithub.id);

    // Step 4: DELETE the remaining login → 409 (cannot remove last login)
    const blockedRes = await agent.delete(`/api/account/logins/${loginGithub.id}`);
    expect(blockedRes.status).toBe(409);

    // Confirm the github login still exists in the DB
    const remaining = await (prisma as any).login.findMany({ where: { user_id: user.id } });
    expect(remaining).toHaveLength(1);
    expect(remaining[0].provider).toBe('github');
  });
});

// ---------------------------------------------------------------------------
// Scenario B: UC-007 narrative — POST workspace, GET reflects it, duplicate → 409
//
// Flow:
//   1. Student has no provisioning requests.
//   2. GET /api/account → provisioningRequests is empty.
//   3. POST workspace → 201.
//   4. GET /api/account → provisioningRequests contains one pending workspace entry.
//   5. POST workspace again → 409.
//
// The individual assertions in account.test.ts split these into separate tests;
// this narrative verifies the GET state after the POST in a single flow.
// ---------------------------------------------------------------------------

describe('Scenario B: UC-007 narrative — workspace request lifecycle via GET /api/account', () => {
  it('POST creates workspace request; GET /api/account reflects it; second POST returns 409', async () => {
    const user = await makeUser({
      primary_email: 'uc007-narrative@example.com',
      role: 'student',
    });
    await makeLogin(user);

    const agent = await loginAs('uc007-narrative@example.com');

    // Step 1: No requests yet
    const before = await agent.get('/api/account');
    expect(before.status).toBe(200);
    expect(before.body.provisioningRequests).toEqual([]);

    // Step 2: Request a workspace
    const postRes = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'workspace' });
    expect(postRes.status).toBe(201);
    expect(postRes.body[0].requestedType).toBe('workspace');
    expect(postRes.body[0].status).toBe('pending');

    // Step 3: GET /api/account now shows the pending request
    const after = await agent.get('/api/account');
    expect(after.status).toBe(200);
    expect(after.body.provisioningRequests).toHaveLength(1);
    expect(after.body.provisioningRequests[0]).toMatchObject({
      requestedType: 'workspace',
      status: 'pending',
      decidedAt: null,
    });

    // Step 4: Second POST for workspace → duplicate → 409
    const dupRes = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'workspace' });
    expect(dupRes.status).toBe(409);
  });
});

// ---------------------------------------------------------------------------
// Scenario C: UC-007 constraint narrative — workspace pending → workspace_and_claude → 409
//
// When a workspace request is already pending, a subsequent workspace_and_claude
// request should return 409 because it would create a duplicate workspace row.
// This specific sequence (workspace pending THEN workspace_and_claude) is NOT
// covered in account.test.ts (which only seeds existing pending requests via
// factory, not by driving the full POST→POST flow).
//
// Related: account.test.ts tests "POST workspace_and_claude with no baseline
// → 201 with two rows". This scenario tests the DIFFERENT path: workspace
// already pending (created via POST), then workspace_and_claude attempt.
// ---------------------------------------------------------------------------

describe('Scenario C: UC-007 constraint — workspace pending then workspace_and_claude → 409', () => {
  it('returns 409 when workspace_and_claude is requested after workspace is already pending', async () => {
    const user = await makeUser({
      primary_email: 'uc007-constraint@example.com',
      role: 'student',
    });
    await makeLogin(user);

    const agent = await loginAs('uc007-constraint@example.com');

    // Step 1: POST workspace → 201 (creates pending workspace)
    const workspaceRes = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'workspace' });
    expect(workspaceRes.status).toBe(201);

    // Verify workspace is now pending in DB
    const pendingRows = await (prisma as any).provisioningRequest.findMany({
      where: { user_id: user.id },
    });
    expect(pendingRows).toHaveLength(1);
    expect(pendingRows[0].requested_type).toBe('workspace');
    expect(pendingRows[0].status).toBe('pending');

    // Step 2: POST workspace_and_claude → 409 (workspace already pending)
    const wacRes = await agent
      .post('/api/account/provisioning-requests')
      .send({ requestType: 'workspace_and_claude' });
    expect(wacRes.status).toBe(409);

    // DB should still have exactly one row (the original workspace request)
    const finalRows = await (prisma as any).provisioningRequest.findMany({
      where: { user_id: user.id },
    });
    expect(finalRows).toHaveLength(1);
    expect(finalRows[0].requested_type).toBe('workspace');
  });
});

// ---------------------------------------------------------------------------
// Scenario D: Cross-user data isolation on GET /api/account with two live sessions
//
// Two student agents are active simultaneously. Each calls GET /api/account.
// Each must see only their own profile, logins, and provisioning requests.
//
// The account.test.ts "data scoping" test uses one agent (userA) and verifies it
// does not see userB's data. This scenario runs BOTH agents and verifies isolation
// in both directions.
// ---------------------------------------------------------------------------

describe('Scenario D: cross-user isolation — two concurrent sessions see only own data', () => {
  it('each student agent sees only their own data when two sessions are active', async () => {
    // Setup: two students with different data
    const userA = await makeUser({
      primary_email: 'isolation-a@example.com',
      role: 'student',
    });
    const userB = await makeUser({
      primary_email: 'isolation-b@example.com',
      role: 'student',
    });

    await makeLogin(userA, { provider: 'google', provider_email: 'a@gmail.com' });
    await makeLogin(userB, { provider: 'github', provider_email: null });

    // Give userA a pending workspace request; userB has none.
    await makeProvisioningRequest(userA, { requested_type: 'workspace', status: 'pending' });

    // Both agents sign in simultaneously (separate cookie jars)
    const agentA = await loginAs('isolation-a@example.com');
    const agentB = await loginAs('isolation-b@example.com');

    // Agent A sees its own data
    const resA = await agentA.get('/api/account');
    expect(resA.status).toBe(200);
    expect(resA.body.profile.primaryEmail).toBe('isolation-a@example.com');
    expect(resA.body.profile.id).toBe(userA.id);
    expect(resA.body.logins).toHaveLength(1);
    expect(resA.body.logins[0].provider).toBe('google');
    expect(resA.body.provisioningRequests).toHaveLength(1);
    expect(resA.body.provisioningRequests[0].requestedType).toBe('workspace');

    // Agent B sees its own data
    const resB = await agentB.get('/api/account');
    expect(resB.status).toBe(200);
    expect(resB.body.profile.primaryEmail).toBe('isolation-b@example.com');
    expect(resB.body.profile.id).toBe(userB.id);
    expect(resB.body.logins).toHaveLength(1);
    expect(resB.body.logins[0].provider).toBe('github');
    expect(resB.body.provisioningRequests).toEqual([]);

    // Verify the two profiles are distinct (not accidentally sharing state)
    expect(resA.body.profile.id).not.toBe(resB.body.profile.id);
  });

  it('DELETE login by one agent does not affect the other agent\'s login count', async () => {
    // Two students, each with two logins
    const userA = await makeUser({
      primary_email: 'del-isolation-a@example.com',
      role: 'student',
    });
    const userB = await makeUser({
      primary_email: 'del-isolation-b@example.com',
      role: 'student',
    });

    const loginA1 = await makeLogin(userA, { provider: 'google' });
    await makeLogin(userA, { provider: 'github' });
    await makeLogin(userB, { provider: 'google' });
    await makeLogin(userB, { provider: 'github' });

    const agentA = await loginAs('del-isolation-a@example.com');
    const agentB = await loginAs('del-isolation-b@example.com');

    // Agent A deletes one of its own logins
    const delRes = await agentA.delete(`/api/account/logins/${loginA1.id}`);
    expect(delRes.status).toBe(204);

    // Agent A now has 1 login
    const resA = await agentA.get('/api/account');
    expect(resA.status).toBe(200);
    expect(resA.body.logins).toHaveLength(1);

    // Agent B still has 2 logins (unaffected)
    const resB = await agentB.get('/api/account');
    expect(resB.status).toBe(200);
    expect(resB.body.logins).toHaveLength(2);
  });
});
