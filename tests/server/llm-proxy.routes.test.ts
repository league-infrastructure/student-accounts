/**
 * Integration tests for the public /proxy/v1/* routes.
 *
 * Swaps `registry.llmProxyForwarder` with a fake so tests focus on auth,
 * status-code mapping, and 503 behaviour without hitting the upstream LLM API.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import app, { registry } from '../../server/src/app';
import { prisma } from '../../server/src/services/prisma';
import { TierPricing } from '../../server/src/services/llm-proxy-pricing';
import type { UsageReport } from '../../server/src/services/llm-proxy-forwarder.service';
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
  /** Fields overriding the default usage report the fake hands to onUsage. */
  lastUsage: null as null | Partial<UsageReport>,
};

/** The report a real forwarder would produce for `req`, with test overrides. */
function fakeReport(req: any, protocol: UsageReport['protocol']): UsageReport {
  return {
    inputTokens: 5,
    outputTokens: 7,
    costUsd: null,
    modelRequested: typeof req.body?.model === 'string' ? req.body.model : null,
    modelSent: 'deepseek/deepseek-v4-flash',
    protocol,
    status: 200,
    ...(forwarderState.lastUsage ?? {}),
  };
}

const fakeForwarder = {
  isConfigured: vi.fn(() => forwarderState.configured),
  forwardMessages: vi.fn(async (req: any, res: any, opts: any) => {
    forwarderState.onForward(req, res, opts);
    // Call onUsage from the fake so the recordUsage path is exercised.
    opts.onUsage(fakeReport(req, 'openai'));
  }),
  // Anthropic path (sprint 003 ticket 003) — same contract, protocol tag differs.
  forwardAnthropicMessages: vi.fn(async (req: any, res: any, opts: any) => {
    forwarderState.onForward(req, res, opts);
    opts.onUsage(fakeReport(req, 'anthropic'));
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
  await (prisma as any).llmProxyRequest.deleteMany();
  await (prisma as any).llmProxyToken.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).group.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

// LLM_PROXY_ANTHROPIC_ENABLED defaults to 'true' (config.ts); tests that need
// the surface off set the env var to 'false' (env wins over DB and default).
beforeEach(async () => {
  delete process.env.LLM_PROXY_ANTHROPIC_ENABLED;
  forwarderState.configured = true;
  forwarderState.onForward = (_req, res, _opts) => {
    res.status(200).json({ ok: true, usage: { input_tokens: 5, output_tokens: 7 } });
  };
  forwarderState.lastUsage = null;
  vi.clearAllMocks();
  await wipeTestState();
});

afterEach(async () => {
  delete process.env.LLM_PROXY_ANTHROPIC_ENABLED;
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
    expect(res.body.endpoint).toBe('/proxy/v1/chat/completions');
    expect(res.body.anthropicEndpoint).toBe('/proxy/v1/messages');
  });

  it('omits anthropicEndpoint when the Anthropic surface is disabled', async () => {
    process.env.LLM_PROXY_ANTHROPIC_ENABLED = 'false';
    const res = await request(app).get('/proxy/v1/health');
    expect(res.status).toBe(200);
    expect(res.body).not.toHaveProperty('anthropicEndpoint');
  });
});

// ---------------------------------------------------------------------------
// GET /proxy/v1/models
// ---------------------------------------------------------------------------

describe('GET /proxy/v1/models', () => {
  it('returns the three-tier model list without auth', async () => {
    const res = await request(app).get('/proxy/v1/models');
    expect(res.status).toBe(200);
    expect(res.body.object).toBe('list');
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data).toHaveLength(3);
    const ids = res.body.data.map((m: any) => m.id);
    expect(ids).toContain('league-large');
    expect(ids).toContain('league-medium');
    expect(ids).toContain('league-small');
    for (const model of res.body.data) {
      expect(model.object).toBe('model');
      expect(model.owned_by).toBe('league');
      // Must NOT expose backing DeepSeek slugs
      expect(model.id).not.toMatch(/deepseek/i);
    }
  });
});

// ---------------------------------------------------------------------------
// GET /proxy — base-URL info
// ---------------------------------------------------------------------------

describe('GET /proxy — base-URL info', () => {
  it('returns JSON describing the proxy (not the SPA HTML)', async () => {
    const res = await request(app).get('/proxy');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.ok).toBe(true);
    expect(res.body.service).toBe('llm-proxy');
    expect(res.body.base).toMatch(/\/proxy$/);
    expect(res.body.openaiBaseUrl).toMatch(/\/proxy\/v1$/);
    expect(res.body.chatCompletions).toMatch(/\/proxy\/v1\/chat\/completions$/);
    expect(res.body.models).toMatch(/\/proxy\/v1\/models$/);
    expect(res.body.health).toMatch(/\/proxy\/v1\/health$/);
  });

  it('lists both protocols and the Claude Code env vars when the Anthropic surface is on (default)', async () => {
    const res = await request(app)
      .get('/proxy')
      .set('X-Forwarded-Proto', 'https')
      .set('X-Forwarded-Host', 'accounts.example.org');
    expect(res.status).toBe(200);
    expect(res.body.base).toBe('https://accounts.example.org/proxy');
    expect(res.body.protocols).toEqual(['openai', 'anthropic']);
    expect(res.body.anthropicEnabled).toBe(true);
    expect(res.body.anthropicBaseUrl).toBe('https://accounts.example.org/proxy');
    expect(res.body.messages).toBe('https://accounts.example.org/proxy/v1/messages');
    expect(res.body.env.openai).toEqual({
      OPENAI_BASE_URL: 'https://accounts.example.org/proxy/v1',
      OPENAI_API_KEY: '<your llmp_ token>',
    });
    expect(res.body.env.anthropic).toEqual({
      ANTHROPIC_BASE_URL: 'https://accounts.example.org/proxy',
      ANTHROPIC_AUTH_TOKEN: '<your llmp_ token>',
      ANTHROPIC_API_KEY: '',
    });
    expect(res.body.note).toMatch(/ANTHROPIC_BASE_URL/);
  });

  it('lists only the OpenAI protocol when LLM_PROXY_ANTHROPIC_ENABLED is "false"', async () => {
    process.env.LLM_PROXY_ANTHROPIC_ENABLED = 'false';
    const res = await request(app).get('/proxy');
    expect(res.status).toBe(200);
    expect(res.body.protocols).toEqual(['openai']);
    expect(res.body.anthropicEnabled).toBe(false);
    expect(res.body).not.toHaveProperty('anthropicBaseUrl');
    expect(res.body).not.toHaveProperty('messages');
    expect(res.body.env).not.toHaveProperty('anthropic');
    expect(res.body.note).not.toMatch(/ANTHROPIC_BASE_URL/);
  });
});

// ---------------------------------------------------------------------------
// POST /proxy/v1/chat/completions — auth
// ---------------------------------------------------------------------------

describe('POST /proxy/v1/chat/completions — authentication', () => {
  it('401 with no Authorization header', async () => {
    const res = await request(app)
      .post('/proxy/v1/chat/completions')
      .send({ model: 'x' });
    expect(res.status).toBe(401);
    expect(res.body.error).toMatch(/bearer/i);
  });

  it('401 for a malformed Authorization header', async () => {
    const res = await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', 'NotBearer abc')
      .send({ model: 'x' });
    expect(res.status).toBe(401);
  });

  it('401 for an unknown bearer token', async () => {
    const res = await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', 'Bearer llmp_garbage')
      .send({ model: 'x' });
    expect(res.status).toBe(401);
  });

  it('401 for a revoked token', async () => {
    const { token, userId } = await grantTokenForStudent();
    // Revoke via the service (uses actorId = the user for simplicity).
    await registry.llmProxyTokens.revoke(userId, userId);
    const res = await request(app)
      .post('/proxy/v1/chat/completions')
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
      .post('/proxy/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x' });
    expect(res.status).toBe(401);
  });

  it('429 when the legacy token quota is exhausted (budget_usd null)', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    await (prisma as any).llmProxyToken.update({
      where: { id: tokenId },
      data: { tokens_used: 1_000_000, budget_usd: null }, // equals token_limit
    });
    const res = await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x' });
    expect(res.status).toBe(429);
    expect(res.body.error).toBe('LLM proxy token quota exhausted');
  });

  it('429 "monthly budget" when spent_usd has reached budget_usd (sprint 003)', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    await (prisma as any).llmProxyToken.update({
      where: { id: tokenId },
      data: { budget_usd: 0.01, spent_usd: 0.01 },
    });
    const res = await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x' });
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/^monthly budget of \$0\.01 reached; resets \d{4}-\d{2}-01$/);
    expect(fakeForwarder.forwardMessages).not.toHaveBeenCalled();
  });

  it('a new UTC month resets the spend and the request goes through', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    await (prisma as any).llmProxyToken.update({
      where: { id: tokenId },
      data: {
        budget_usd: 0.01,
        spent_usd: 0.01,
        period_start: new Date('2000-01-01T00:00:00.000Z'),
      },
    });
    const res = await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x' });
    expect(res.status).toBe(200);
    const row = await (prisma as any).llmProxyToken.findUnique({ where: { id: tokenId } });
    expect(row.period_start.getUTCDate()).toBe(1);
    expect(row.period_start.getTime()).toBeGreaterThan(Date.parse('2026-01-01T00:00:00Z'));
  });
});

// ---------------------------------------------------------------------------
// POST /proxy/v1/chat/completions — happy path + 503
// ---------------------------------------------------------------------------

describe('POST /proxy/v1/chat/completions — forwarding', () => {
  it('forwards to the forwarder and returns 200 on the happy path', async () => {
    const { token } = await grantTokenForStudent();

    const res = await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({
        model: 'league-large',
        messages: [{ role: 'user', content: 'hi' }],
      });
    expect(res.status).toBe(200);
    expect(fakeForwarder.forwardMessages).toHaveBeenCalledTimes(1);
    // The request body reached the fake unchanged.
    const [req] = fakeForwarder.forwardMessages.mock.calls[0];
    expect(req.body.model).toBe('league-large');
  });

  it('invokes recordUsage via onUsage and increments counters', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    forwarderState.lastUsage = { inputTokens: 42, outputTokens: 58 };
    await request(app)
      .post('/proxy/v1/chat/completions')
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

  it('passes the forwarder usage report to recordUsage unchanged (sprint 003)', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    forwarderState.lastUsage = {
      inputTokens: 11,
      outputTokens: 22,
      costUsd: 0.0042,
      modelSent: 'deepseek/deepseek-v4-pro',
    };
    const spy = vi.spyOn(registry.llmProxyTokens, 'recordUsage');
    try {
      await request(app)
        .post('/proxy/v1/chat/completions')
        .set('Authorization', `Bearer ${token}`)
        .send({ model: 'league-large', messages: [] })
        .expect(200);

      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(tokenId, {
        inputTokens: 11,
        outputTokens: 22,
        costUsd: 0.0042,
        modelRequested: 'league-large',
        modelSent: 'deepseek/deepseek-v4-pro',
        protocol: 'openai',
        status: 200,
      });
    } finally {
      spy.mockRestore();
    }
  });

  it('records the reported cost and a request row when the forwarder supplies cost', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    forwarderState.lastUsage = { inputTokens: 100, outputTokens: 50, costUsd: 0.0042 };
    await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'league-medium', messages: [] })
      .expect(200);
    await new Promise((r) => setTimeout(r, 10));

    const row = await (prisma as any).llmProxyToken.findUnique({ where: { id: tokenId } });
    expect(row.spent_usd).toBeCloseTo(0.0042, 12);
    const requests = await (prisma as any).llmProxyRequest.findMany({ where: { token_id: tokenId } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      protocol: 'openai',
      model_requested: 'league-medium',
      model_sent: 'deepseek/deepseek-v4-flash',
      input_tokens: 100,
      output_tokens: 50,
      cost_usd: 0.0042,
      status: 200,
    });
  });

  it('falls back to TierPricing for cost_usd when the forwarder reports a null cost', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    forwarderState.lastUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: null,
      modelSent: 'deepseek/deepseek-v3.2',
    };
    await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'league-small', messages: [] })
      .expect(200);
    await new Promise((r) => setTimeout(r, 10));

    // Same config path the registry's pricing uses, so the estimate matches.
    const pricing = new TierPricing();
    const expected = pricing.costUsd(pricing.tierFor('deepseek/deepseek-v3.2'), 1000, 500);
    expect(expected).toBeGreaterThan(0);

    const requests = await (prisma as any).llmProxyRequest.findMany({ where: { token_id: tokenId } });
    expect(requests).toHaveLength(1);
    expect(requests[0].cost_usd).toBeCloseTo(expected, 12);
    expect(requests[0].model_sent).toBe('deepseek/deepseek-v3.2');
    const row = await (prisma as any).llmProxyToken.findUnique({ where: { id: tokenId } });
    expect(row.spent_usd).toBeCloseTo(expected, 12);
  });

  it('records an upstream error as a request row with its status and zero tokens/cost', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    forwarderState.onForward = (_req, res) => {
      res.status(429).json({ error: 'rate limited' });
    };
    forwarderState.lastUsage = { inputTokens: 0, outputTokens: 0, costUsd: null, status: 429 };
    await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x', messages: [] })
      .expect(429);
    await new Promise((r) => setTimeout(r, 10));

    const requests = await (prisma as any).llmProxyRequest.findMany({ where: { token_id: tokenId } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({ status: 429, input_tokens: 0, output_tokens: 0, cost_usd: 0 });
    const row = await (prisma as any).llmProxyToken.findUnique({ where: { id: tokenId } });
    expect(row.request_count).toBe(1);
    expect(row.spent_usd).toBe(0);
  });

  it('returns 503 when the forwarder reports not configured', async () => {
    const { token } = await grantTokenForStudent();
    forwarderState.configured = false;
    const res = await request(app)
      .post('/proxy/v1/chat/completions')
      .set('Authorization', `Bearer ${token}`)
      .send({ model: 'x' });
    expect(res.status).toBe(503);
    expect(fakeForwarder.forwardMessages).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// Method-not-allowed on /chat/completions
// ---------------------------------------------------------------------------

describe('/proxy/v1/chat/completions — other methods', () => {
  it('GET returns 405', async () => {
    const res = await request(app).get('/proxy/v1/chat/completions');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});

// ---------------------------------------------------------------------------
// POST /proxy/v1/messages — Anthropic protocol (sprint 003 ticket 003)
// ---------------------------------------------------------------------------

const anthropicBody = {
  model: 'claude-sonnet-4-5-20250929',
  max_tokens: 32,
  messages: [{ role: 'user', content: 'hi' }],
};

describe('POST /proxy/v1/messages — feature flag', () => {
  it('404 { error: "anthropic endpoint disabled" } when LLM_PROXY_ANTHROPIC_ENABLED is "false", even with a valid token', async () => {
    process.env.LLM_PROXY_ANTHROPIC_ENABLED = 'false';
    const { token } = await grantTokenForStudent();
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('x-api-key', token)
      .send(anthropicBody);
    expect(res.status).toBe(404);
    expect(res.body).toEqual({ error: 'anthropic endpoint disabled' });
    expect(fakeForwarder.forwardAnthropicMessages).not.toHaveBeenCalled();
    expect(fakeForwarder.forwardMessages).not.toHaveBeenCalled();
  });

  it('404 when disabled and unauthenticated (the flag check runs before auth)', async () => {
    process.env.LLM_PROXY_ANTHROPIC_ENABLED = 'false';
    const res = await request(app).post('/proxy/v1/messages').send(anthropicBody);
    expect(res.status).toBe(404);
    expect(res.body.error).toBe('anthropic endpoint disabled');
  });

  it('GET /messages is 404 while disabled and 405 while enabled', async () => {
    process.env.LLM_PROXY_ANTHROPIC_ENABLED = 'false';
    expect((await request(app).get('/proxy/v1/messages')).status).toBe(404);
    delete process.env.LLM_PROXY_ANTHROPIC_ENABLED;
    const res = await request(app).get('/proxy/v1/messages');
    expect(res.status).toBe(405);
    expect(res.headers.allow).toBe('POST');
  });
});

describe('POST /proxy/v1/messages — authentication', () => {
  it('401 with neither x-api-key nor Authorization', async () => {
    const res = await request(app).post('/proxy/v1/messages').send(anthropicBody);
    expect(res.status).toBe(401);
    expect(fakeForwarder.forwardAnthropicMessages).not.toHaveBeenCalled();
  });

  it('401 for an unknown x-api-key token', async () => {
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('x-api-key', 'llmp_garbage')
      .send(anthropicBody);
    expect(res.status).toBe(401);
  });

  it('401 for an unknown bearer token', async () => {
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', 'Bearer llmp_garbage')
      .send(anthropicBody);
    expect(res.status).toBe(401);
  });

  it('401 for a revoked token sent as x-api-key', async () => {
    const { token, userId } = await grantTokenForStudent();
    await registry.llmProxyTokens.revoke(userId, userId);
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('x-api-key', token)
      .send(anthropicBody);
    expect(res.status).toBe(401);
  });

  it('200 with x-api-key (ANTHROPIC_API_KEY style)', async () => {
    const { token } = await grantTokenForStudent();
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('x-api-key', token)
      .set('anthropic-version', '2023-06-01')
      .send(anthropicBody);
    expect(res.status).toBe(200);
    expect(fakeForwarder.forwardAnthropicMessages).toHaveBeenCalledTimes(1);
    expect(fakeForwarder.forwardMessages).not.toHaveBeenCalled();
    const [req] = fakeForwarder.forwardAnthropicMessages.mock.calls[0];
    expect(req.body).toEqual(anthropicBody);
  });

  it('200 with Authorization: Bearer (ANTHROPIC_AUTH_TOKEN style)', async () => {
    const { token } = await grantTokenForStudent();
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send(anthropicBody);
    expect(res.status).toBe(200);
    expect(fakeForwarder.forwardAnthropicMessages).toHaveBeenCalledTimes(1);
  });

  it('prefers the llmp_ x-api-key when Authorization carries a foreign token (Claude Code sends both)', async () => {
    const { token } = await grantTokenForStudent();
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('x-api-key', token)
      .set('Authorization', 'Bearer sk-ant-oat01-not-ours')
      .send(anthropicBody);
    expect(res.status).toBe(200);
  });

  it('429 "monthly budget" applies to this route too', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    await (prisma as any).llmProxyToken.update({
      where: { id: tokenId },
      data: { budget_usd: 0.01, spent_usd: 0.01 },
    });
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('x-api-key', token)
      .send(anthropicBody);
    expect(res.status).toBe(429);
    expect(res.body.error).toMatch(/^monthly budget of \$0\.01 reached; resets \d{4}-\d{2}-01$/);
    expect(fakeForwarder.forwardAnthropicMessages).not.toHaveBeenCalled();
  });

  it('429 when the legacy token quota is exhausted', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    await (prisma as any).llmProxyToken.update({
      where: { id: tokenId },
      data: { tokens_used: 1_000_000, budget_usd: null },
    });
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('Authorization', `Bearer ${token}`)
      .send(anthropicBody);
    expect(res.status).toBe(429);
  });
});

describe('POST /proxy/v1/messages — forwarding and accounting', () => {
  it('returns 503 when the forwarder reports not configured', async () => {
    const { token } = await grantTokenForStudent();
    forwarderState.configured = false;
    const res = await request(app)
      .post('/proxy/v1/messages')
      .set('x-api-key', token)
      .send(anthropicBody);
    expect(res.status).toBe(503);
    expect(res.body.error).toMatch(/OPENROUTER_API_KEY/);
    expect(fakeForwarder.forwardAnthropicMessages).not.toHaveBeenCalled();
  });

  it('passes the Anthropic usage report to recordUsage and writes a protocol=anthropic request row', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    forwarderState.lastUsage = { inputTokens: 25, outputTokens: 8, costUsd: 0.0009 };
    const spy = vi.spyOn(registry.llmProxyTokens, 'recordUsage');
    try {
      await request(app)
        .post('/proxy/v1/messages')
        .set('x-api-key', token)
        .send(anthropicBody)
        .expect(200);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy).toHaveBeenCalledWith(tokenId, {
        inputTokens: 25,
        outputTokens: 8,
        costUsd: 0.0009,
        modelRequested: 'claude-sonnet-4-5-20250929',
        modelSent: 'deepseek/deepseek-v4-flash',
        protocol: 'anthropic',
        status: 200,
      });
    } finally {
      spy.mockRestore();
    }
    await new Promise((r) => setTimeout(r, 10));

    const row = await (prisma as any).llmProxyToken.findUnique({ where: { id: tokenId } });
    expect(row.tokens_used).toBe(33);
    expect(row.request_count).toBe(1);
    expect(row.spent_usd).toBeCloseTo(0.0009, 12);
    const requests = await (prisma as any).llmProxyRequest.findMany({ where: { token_id: tokenId } });
    expect(requests).toHaveLength(1);
    expect(requests[0]).toMatchObject({
      protocol: 'anthropic',
      model_requested: 'claude-sonnet-4-5-20250929',
      model_sent: 'deepseek/deepseek-v4-flash',
      input_tokens: 25,
      output_tokens: 8,
      cost_usd: 0.0009,
      status: 200,
    });
  });

  it('a null cost is estimated from TierPricing like the OpenAI path', async () => {
    const { token, tokenId } = await grantTokenForStudent();
    forwarderState.lastUsage = {
      inputTokens: 1000,
      outputTokens: 500,
      costUsd: null,
      modelSent: 'deepseek/deepseek-v4-pro',
    };
    await request(app)
      .post('/proxy/v1/messages')
      .set('x-api-key', token)
      .send({ ...anthropicBody, model: 'claude-opus-4-1' })
      .expect(200);
    await new Promise((r) => setTimeout(r, 10));

    const pricing = new TierPricing();
    const expected = pricing.costUsd(pricing.tierFor('deepseek/deepseek-v4-pro'), 1000, 500);
    const requests = await (prisma as any).llmProxyRequest.findMany({ where: { token_id: tokenId } });
    expect(requests).toHaveLength(1);
    expect(requests[0].cost_usd).toBeCloseTo(expected, 12);
    expect(requests[0].protocol).toBe('anthropic');
  });
});

describe('POST /proxy/v1/messages/count_tokens', () => {
  it('404 JSON explaining that the upstream has no token-counting endpoint', async () => {
    const { token } = await grantTokenForStudent();
    const res = await request(app)
      .post('/proxy/v1/messages/count_tokens')
      .set('x-api-key', token)
      .send(anthropicBody);
    expect(res.status).toBe(404);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.body.error).toMatch(/count_tokens/);
    expect(res.body.error).toMatch(/not supported/i);
    expect(fakeForwarder.forwardAnthropicMessages).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// CORS headers
// ---------------------------------------------------------------------------

describe('CORS headers on /proxy/v1/*', () => {
  it('allows the OpenAI and Anthropic SDK request headers (sprint 003)', async () => {
    const res = await request(app)
      .options('/proxy/v1/messages')
      .set('Origin', 'https://example.com');
    expect(res.status).toBe(204);
    const allowHeaders = res.headers['access-control-allow-headers'] ?? '';
    expect(allowHeaders).toMatch(/Content-Type/i);
    expect(allowHeaders).toMatch(/Authorization/i);
    expect(allowHeaders).toMatch(/anthropic-version/i);
    expect(allowHeaders).toMatch(/anthropic-beta/i);
    expect(allowHeaders).toMatch(/x-api-key/i);
    expect(res.headers['access-control-allow-origin']).toBe('*');
  });
});
