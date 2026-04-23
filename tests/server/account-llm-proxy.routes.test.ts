/**
 * Integration tests for GET /api/account/llm-proxy (Sprint 013 T006).
 *
 * Verifies the enabled + disabled response shapes, role gating, and — most
 * importantly — that the endpoint never leaks the plaintext token or its
 * hash to the student.
 */
import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';
import { makeUser } from './helpers/factories';

let studentAgent: ReturnType<typeof request.agent>;
let studentId: number;

beforeAll(async () => {
  studentAgent = request.agent(app);
  await studentAgent
    .post('/api/auth/test-login')
    .send({
      email: 'student-llm-proxy@example.com',
      displayName: 'Student LLM Proxy',
      role: 'STUDENT',
    })
    .expect(200);
  const student = await prisma.user.findFirst({
    where: { primary_email: 'student-llm-proxy@example.com' },
  });
  studentId = student!.id;
}, 30000);

async function wipeExceptStudent() {
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany({ where: { user_id: { not: studentId } } });
  // Keep the shared student and any sibling staff/admin we created here;
  // wiping them breaks the session-based `studentAgent`. The factory seq
  // counter is process-scoped, so re-running against a handful of leftover
  // rows is safe.
  await (prisma as any).user.deleteMany({
    where: {
      id: { not: studentId },
      primary_email: {
        notIn: [
          'staff-llm-proxy@example.com',
          'admin2-llm-proxy@example.com',
        ],
      },
    },
  });
  await (prisma as any).cohort.deleteMany();
}

beforeEach(async () => {
  await wipeExceptStudent();
});

afterEach(async () => {
  await wipeExceptStudent();
});

// ---------------------------------------------------------------------------
// Auth + role gating
// ---------------------------------------------------------------------------

describe('GET /api/account/llm-proxy — auth', () => {
  it('401 unauthenticated', async () => {
    const res = await request(app).get('/api/account/llm-proxy');
    expect(res.status).toBe(401);
  });

  it('403 for a staff user', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/test-login')
      .send({
        email: 'staff-llm-proxy@example.com',
        displayName: 'Staff',
        role: 'staff',
      })
      .expect(200);
    const res = await agent.get('/api/account/llm-proxy');
    expect(res.status).toBe(403);
  });

  it('403 for an admin user', async () => {
    const agent = request.agent(app);
    await agent
      .post('/api/auth/test-login')
      .send({
        email: 'admin2-llm-proxy@example.com',
        displayName: 'Admin2',
        role: 'ADMIN',
      })
      .expect(200);
    const res = await agent.get('/api/account/llm-proxy');
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
// Disabled + enabled shapes
// ---------------------------------------------------------------------------

describe('GET /api/account/llm-proxy — response shape', () => {
  it('returns { enabled: false, endpoint } when there is no active token', async () => {
    const res = await studentAgent.get('/api/account/llm-proxy');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(false);
    expect(typeof res.body.endpoint).toBe('string');
    expect(res.body.endpoint).toMatch(/\/proxy\/v1$/);
    expect(res.body).not.toHaveProperty('token');
    expect(res.body).not.toHaveProperty('tokenHash');
  });

  it('returns the enabled shape including the plaintext token, without the hash', async () => {
    const admin = await makeUser({ role: 'admin' });
    const { token: granted } = await registry.llmProxyTokens.grant(
      studentId,
      {
        expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
        tokenLimit: 777_000,
      },
      admin.id,
    );

    const res = await studentAgent.get('/api/account/llm-proxy');
    expect(res.status).toBe(200);
    expect(res.body.enabled).toBe(true);
    expect(res.body.tokenLimit).toBe(777_000);
    expect(res.body.tokensUsed).toBe(0);
    expect(res.body.requestCount).toBe(0);
    expect(typeof res.body.endpoint).toBe('string');
    expect(res.body.endpoint).toMatch(/\/proxy\/v1$/);
    // Plaintext token is surfaced so the student can see and use it.
    expect(res.body.token).toBe(granted);
    expect(res.body).not.toHaveProperty('tokenHash');
    expect(res.body).not.toHaveProperty('token_hash');
  });
});
