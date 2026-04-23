/**
 * Integration tests for the public /proxy/v1/* routes (Sprint 013 T004).
 *
 * Swaps `registry.llmProxyForwarder` with a fake so tests focus on auth,
 * status-code mapping, and 503 behaviour without hitting Anthropic.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';
import { makeUser } from './helpers/factories';

// ---------------------------------------------------------------------------
// Fake forwarder — records the arguments it was called with and lets each
// test dictate the response. isConfigured() is toggled for the 503 path.
// ---------------------------------------------------------------------------

const forwarderState = {
  configured: true,
  onForward: (_req: any, res: any, _opts: any) => {
    res.status(200).json({ ok: true, usage: { input_tokens: 5, output_tokens: 7 } });
  },
  lastUsage: null as null | { input: number; output: number },
};

const fakeForwarder = {
  isConfigured: vi.fn(() => forwarderState.configured),
  forwardMessages: vi.fn(async (req: any, res: any, opts: any) => {
    forwarderState.onForward(req, res, opts);
    // Call onUsage from the fake so the recordUsage path is exercised.
    opts.onUsage(
      forwarderState.lastUsage?.input ?? 5,
      forwarderState.lastUsage?.output ?? 7,
    );
  }),
};

let originalForwarder: any;

beforeAll(async () => {
  originalForwarder = (registry as any).llmProxyForwarder;
  (registry as any).llmProxyForwarder = fakeForwarder;
}, 30000);

afterAll(async () => {
  (registry as any).llmProxyForwarder = originalForwarder;
});

async function wipeTestState() {
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

beforeEach(async () => {
  forwarderState.configured = true;
  forwarderState.onForward = (_req, res, _opts) => {
    res.status(200).json({ ok: true, usage: { input_tokens: 5, output_tokens: 7 } });
  };
  forwarderState.lastUsage = null;
  vi.clearAllMocks();
  await wipeTestState();
});

afterEach(async () => {
  await wipeTestState();
});

// ---------------------------------------------------------------------------
// Token fixtures
// ---------------------------------------------------------------------------

async function grantTokenForStudent(): Promise<{
  token: string;
  tokenId: number;
  userId: number;
}> {
  const admin = await makeUser({ role: 'admin' });
  const student = await makeUser({ role: 'student' });
  const result = await registry.llmProxyTokens.grant(
    student.id,
    {
      expiresAt: new Date(Date.now() + 30 * 24 * 3600 * 1000),
      tokenLimit: 1_000_000,
    },
    admin.id,
  );
  return {
    token: result.token,
    tokenId: result.row.id,
    userId: student.id,
  };
}

// ---------------------------------------------------------------------------
// GET /proxy/v1/health
// ---------------------------------------------------------------------------

describe('GET /proxy/v1/health', () => {
  it('returns 200 without auth', async () => {
    const res = await request(app).get('/proxy/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.endpoint).toBe('/proxy/v1/messages');
  });
});

// ---------------------------------------------------------------------------
// POST /proxy/v1/messages — auth
// ---------------------------------------------------------------------------

describe('POST /proxy/v1/messages — authentication', () => {
  it('401 with no Authorization header', async () => {
    const res = await request(app)
      .post('/proxy/v1/messages')
      .send({ model: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/bearer/i);
  });

  it('401 for a malformed Authorization header', async () => {
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', 'NotBearer abc')
      .send({ model: 'x' });
    expect(res.status).toBe(401);
  });

  it('401 for an unknown bearer token', async () => {
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', 'Bearer llmp_garbage')
      .send({ model: 'x' });
    expect(res.status).toBe(401);
  });

  it('401 for a revoked token', async () => {
    const { token, userId } = await grantTokenForStudent();
    // Revoke via the service (uses actorId = the user for simplicity).
    await registry.llmProxyTokens.revoke(userId, userId);
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x' });
    expect(res.status).toBe(401);
  });

  it('401 for an expired token', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    await (prisma as any).llmProxyToken.update({
      where: { id: tokenId },
      data: { expires_at: new Date(Date.now() - 24 * 3600 * 1000) },
    });
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x' });
    expect(res.status).toBe(401);
  });

  it('429 when quota is exhausted', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    await (prisma as any).llmProxyToken.update({
      where: { id: tokenId },
      data: { tokens_used: 1_000_000 }, // equals token_limit
    });
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x' });
    expect(res.status).toBe(429);
  });
});

// ---------------------------------------------------------------------------
// POST /proxy/v1/messages — happy path + 503
// ---------------------------------------------------------------------------

describe('POST /proxy/v1/messages — forwarding', () => {
  it('forwards to the forwarder and returns 200 on the happy path', async () => {
    const { token } = await grantTokenForStudent();

    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({
        model: 'claude-3-5-haiku-latest',
        messages: [{ role: 'user', content: 'hi' }],
      });
    expect(res.status).toBe(200);
    expect(fakeForwarder.forwardMessages).toHaveBeenCalledTimes(1);
    // The request body reached the fake unchanged.
    const [req] = fakeForwarder.forwardMessages.mock.calls[0];
    expect(req.body.model).toBe('claude-3-5-haiku-latest');
  });

  it('invokes recordUsage via onUsage and increments counters', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    forwarderState.lastUsage = { input: 42, output: 58 };
    await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x' })
      .expect(200);

    // recordUsage is fire-and-forget; give the micro-task a tick to flush.
    await new Promise((r) => setTimeout(r, 10));

    const row = await (prisma as any).llmProxyToken.findUnique({
      where: { id: tokenId },
    });
    expect(row.tokens_used).toBe(42 + 58);
    expect(row.request_count).toBe(1);
  });

  it('returns 503 when the forwarder reports not configured', async () => {
    const { token } = await grantTokenForStudent();
    forwarderState.configured = false;
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x' });
    expect(res.status).toBe(503);
    expect(fakeForwarder.forwardMessages).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Method-not-allowed
// ---------------------------------------------------------------------------

describe('/proxy/v1/messages — other methods', () => {
  it('GET returns 405', async () => {
    const res = await request(app).get('/proxy/v1/messages');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});
