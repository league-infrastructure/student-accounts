/**
 * Integration tests for POST /api/auth/logout (T009).
 *
 * Covers:
 *  - Authenticated user: POST /api/auth/logout returns 200 { success: true }.
 *  - Session is destroyed after logout (follow-up request to guarded route returns 401).
 *  - Best-effort audit event (auth_logout) is written when a userId was in the session.
 *  - Unauthenticated request: POST /api/auth/logout returns 200 (idempotent).
 *  - No audit event is written when there is no session userId.
 */

import request from 'supertest';
import { prisma } from '../../../server/src/services/prisma.js';
import { makeUser } from '../helpers/factories.js';

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
 * Log in a test user via POST /api/auth/test-login, returning a supertest
 * agent with the session cookie attached.
 */
async function loginTestUser(
  agent: ReturnType<typeof request.agent>,
  overrides: { email?: string; role?: string } = {},
): Promise<void> {
  await agent.post('/api/auth/test-login').send({
    email: overrides.email ?? 'logout-test@example.com',
    displayName: 'Logout Test User',
    role: overrides.role ?? 'student',
  });
}

// ---------------------------------------------------------------------------
// Test setup / teardown
// ---------------------------------------------------------------------------

beforeEach(async () => {
  await cleanDb();
});

afterAll(async () => {
  await cleanDb();
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout — authenticated user
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout — authenticated user', () => {
  it('returns 200 with { success: true }', async () => {
    const agent = request.agent(app);
    await loginTestUser(agent);

    const res = await agent.post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('destroys the session — subsequent request to guarded route returns 401', async () => {
    const agent = request.agent(app);
    await loginTestUser(agent);

    // Confirm we are authenticated
    const meBefore = await agent.get('/api/auth/me');
    expect(meBefore.status).toBe(200);

    // Log out
    await agent.post('/api/auth/logout');

    // Session should be gone — /api/auth/me returns 401
    const meAfter = await agent.get('/api/auth/me');
    expect(meAfter.status).toBe(401);
  });

  it('writes an auth_logout audit event for the logged-in user', async () => {
    const user = await makeUser({ primary_email: 'audit-logout@example.com' });

    const agent = request.agent(app);
    await loginTestUser(agent, { email: 'audit-logout@example.com' });

    // Clear any audit events from the login itself so we can count only the logout event.
    await (prisma as any).auditEvent.deleteMany();

    await agent.post('/api/auth/logout');

    // Give the fire-and-forget audit write a moment to complete.
    // This is best-effort; if it hasn't run yet the test will still catch it
    // via the event loop flushing on the next await.
    await new Promise<void>((resolve) => setImmediate(resolve));

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'auth_logout' },
    });

    expect(events.length).toBe(1);
    expect(events[0].actor_user_id).toBe(user.id);
    expect(events[0].target_user_id).toBe(user.id);
  });
});

// ---------------------------------------------------------------------------
// POST /api/auth/logout — unauthenticated (idempotent)
// ---------------------------------------------------------------------------

describe('POST /api/auth/logout — unauthenticated (idempotent)', () => {
  it('returns 200 with { success: true } when no session exists', async () => {
    // Plain request with no session cookie
    const res = await request(app).post('/api/auth/logout');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true });
  });

  it('does not write an auth_logout audit event when there is no session userId', async () => {
    await (prisma as any).auditEvent.deleteMany();

    await request(app).post('/api/auth/logout');

    // Flush the event loop so any fire-and-forget writes have a chance to run.
    await new Promise<void>((resolve) => setImmediate(resolve));

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'auth_logout' },
    });

    expect(events.length).toBe(0);
  });
});
