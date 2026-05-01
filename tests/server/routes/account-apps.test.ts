/**
 * Integration tests for GET /api/account/apps — Sprint 016 ticket 001.
 *
 * Tests use the real SQLite test DB. Sessions are established via
 * POST /api/auth/test-login, which is available outside production.
 * LlmProxyToken records are inserted directly via Prisma to test the
 * with-token path without going through the grant flow.
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
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

/** Sign in as the given user and return an authenticated supertest agent. */
async function loginAs(email: string, role: 'student' | 'staff' | 'admin'): Promise<request.Agent> {
  const agent = request.agent(app);
  const res = await agent.post('/api/auth/test-login').send({ email, role });
  expect(res.status).toBe(200);
  return agent;
}

/** Insert an active LlmProxyToken for the given user (bypasses service layer). */
async function grantLlmToken(userId: number): Promise<void> {
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * 365); // 1 year
  await (prisma as any).llmProxyToken.create({
    data: {
      user_id: userId,
      token_hash: `test-hash-${userId}-${Date.now()}`,
      // Active: revoked_at is null (default) and expires_at is in the future.
      expires_at: expiresAt,
      token_limit: 100000,
      tokens_used: 0,
      request_count: 0,
    },
  });
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
// Unauthenticated
// ===========================================================================

describe('GET /api/account/apps — unauthenticated', () => {
  it('returns 401 when no session exists', async () => {
    const res = await request(app).get('/api/account/apps');
    expect(res.status).toBe(401);
  });
});

// ===========================================================================
// Student without LLM token
// ===========================================================================

describe('GET /api/account/apps — student without LLM token', () => {
  it('returns 200 with empty tiles array', async () => {
    const user = await makeUser({ role: 'student' });
    const agent = await loginAs(user.primary_email, 'student');

    const res = await agent.get('/api/account/apps');
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('tiles');
    expect(Array.isArray(res.body.tiles)).toBe(true);
    expect(res.body.tiles).toHaveLength(0);
  });

  it('does not include llm-proxy or user-management tiles', async () => {
    const user = await makeUser({ role: 'student' });
    const agent = await loginAs(user.primary_email, 'student');

    const res = await agent.get('/api/account/apps');
    const ids = res.body.tiles.map((t: any) => t.id);
    expect(ids).not.toContain('llm-proxy');
    expect(ids).not.toContain('user-management');
  });
});

// ===========================================================================
// Student with LLM token
// ===========================================================================

describe('GET /api/account/apps — student with active LLM token', () => {
  it('returns the llm-proxy tile', async () => {
    const user = await makeUser({ role: 'student' });
    await grantLlmToken(user.id);
    const agent = await loginAs(user.primary_email, 'student');

    const res = await agent.get('/api/account/apps');
    expect(res.status).toBe(200);
    const ids = res.body.tiles.map((t: any) => t.id);
    expect(ids).toContain('llm-proxy');
  });

  it('does not include user-management tile', async () => {
    const user = await makeUser({ role: 'student' });
    await grantLlmToken(user.id);
    const agent = await loginAs(user.primary_email, 'student');

    const res = await agent.get('/api/account/apps');
    const ids = res.body.tiles.map((t: any) => t.id);
    expect(ids).not.toContain('user-management');
  });
});

// ===========================================================================
// Staff
// ===========================================================================

describe('GET /api/account/apps — staff', () => {
  it('returns user-management and staff-directory tiles', async () => {
    const user = await makeUser({ role: 'staff' });
    const agent = await loginAs(user.primary_email, 'staff');

    const res = await agent.get('/api/account/apps');
    expect(res.status).toBe(200);
    const ids = res.body.tiles.map((t: any) => t.id);
    expect(ids).toContain('user-management');
    expect(ids).toContain('staff-directory');
  });

  it('does not return cohorts or groups for staff', async () => {
    const user = await makeUser({ role: 'staff' });
    const agent = await loginAs(user.primary_email, 'staff');

    const res = await agent.get('/api/account/apps');
    const ids = res.body.tiles.map((t: any) => t.id);
    expect(ids).not.toContain('cohorts');
    expect(ids).not.toContain('groups');
  });
});

// ===========================================================================
// Admin
// ===========================================================================

describe('GET /api/account/apps — admin', () => {
  it('returns user-management, staff-directory, cohorts, and groups', async () => {
    const user = await makeUser({ role: 'admin' });
    const agent = await loginAs(user.primary_email, 'admin');

    const res = await agent.get('/api/account/apps');
    expect(res.status).toBe(200);
    const ids = res.body.tiles.map((t: any) => t.id);
    expect(ids).toContain('user-management');
    expect(ids).toContain('staff-directory');
    expect(ids).toContain('cohorts');
    expect(ids).toContain('groups');
  });

  it('does not return llm-proxy for admin', async () => {
    const user = await makeUser({ role: 'admin' });
    const agent = await loginAs(user.primary_email, 'admin');

    const res = await agent.get('/api/account/apps');
    const ids = res.body.tiles.map((t: any) => t.id);
    expect(ids).not.toContain('llm-proxy');
  });

  it('each tile has id, title, description, href, and icon fields', async () => {
    const user = await makeUser({ role: 'admin' });
    const agent = await loginAs(user.primary_email, 'admin');

    const res = await agent.get('/api/account/apps');
    for (const tile of res.body.tiles) {
      expect(typeof tile.id).toBe('string');
      expect(typeof tile.title).toBe('string');
      expect(typeof tile.description).toBe('string');
      expect(typeof tile.href).toBe('string');
      expect(typeof tile.icon).toBe('string');
    }
  });
});
