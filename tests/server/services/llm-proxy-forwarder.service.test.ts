/**
 * Unit tests for LlmProxyForwarderService — OpenRouter/OpenAI path.
 *
 * Mocks the global `fetch` so we can exercise the non-streaming and
 * streaming paths end-to-end without a real OpenRouter account.
 *
 * Coverage areas:
 *  1. resolveLlmProxyApiKey() — env var precedence and placeholder guard
 *  2. mapModel() — all tier aliases and unknown/absent fallback
 *  3. Non-streaming path — URL, headers, usage extraction
 *  4. Streaming path — stream_options injection, usage from final chunk
 *  5. Client disconnect — AbortController fires
 *  6. isConfigured() — key present vs absent
 *  7. Cost accounting (sprint 003) — usage.include injection, usage.cost
 *     parsing (JSON body and final SSE chunk), UsageReport shape
 *  8. Anthropic path (sprint 003 ticket 003) — forwardAnthropicMessages:
 *     upstream URL, header passthrough, body untouched except model, usage
 *     from the JSON body / message_start + message_delta, protocol tag
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  LlmProxyForwarderService,
  LlmProxyNotConfiguredError,
  resolveLlmProxyApiKey,
  mapModel,
  type UsageReport,
} from '../../../server/src/services/llm-proxy-forwarder.service.js';

// ---------------------------------------------------------------------------
// Fake Express req / res
// ---------------------------------------------------------------------------

function makeFakeReq(body: any, headers: Record<string, string> = {}) {
  return {
    body,
    header(name: string) {
      return headers[name.toLowerCase()];
    },
    originalUrl: '/proxy/v1/messages',
  };
}

class FakeResponse extends EventEmitter {
  statusCode: number | undefined;
  headers: Record<string, string> = {};
  chunks: Buffer[] = [];
  headersSent = false;
  writableEnded = false;
  sentBody: string | null = null;

  status(code: number) {
    this.statusCode = code;
    return this;
  }
  set(name: string, value: string) {
    this.headers[name.toLowerCase()] = value;
    return this;
  }
  send(body: string) {
    this.headersSent = true;
    this.writableEnded = true;
    this.sentBody = body;
    return this;
  }
  write(chunk: Buffer) {
    this.headersSent = true;
    this.chunks.push(Buffer.from(chunk));
    return true;
  }
  end() {
    this.writableEnded = true;
    return this;
  }
  flushHeaders() {
    this.headersSent = true;
  }
  json(body: any) {
    this.headersSent = true;
    this.writableEnded = true;
    this.sentBody = JSON.stringify(body);
    return this;
  }
}

// ---------------------------------------------------------------------------
// Helpers — Response fixtures
// ---------------------------------------------------------------------------

function jsonResponse(status: number, body: any): any {
  const text = JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-type') return 'application/json';
        return null;
      },
    },
    body: null,
    text: async () => text,
  };
}

function sseResponse(chunks: string[]): any {
  const encoder = new TextEncoder();
  let i = 0;
  const stream = {
    getReader() {
      return {
        async read() {
          if (i < chunks.length) {
            const value = encoder.encode(chunks[i++]);
            return { value, done: false };
          }
          return { value: undefined, done: true };
        },
      };
    },
  };
  return {
    ok: true,
    status: 200,
    headers: {
      get(name: string) {
        if (name.toLowerCase() === 'content-type') return 'text/event-stream';
        return null;
      },
    },
    body: stream,
    text: async () => '',
  };
}

// ---------------------------------------------------------------------------
// Env var save/restore
// ---------------------------------------------------------------------------

const ENV_KEYS = [
  'OPENROUTER_API_KEY',
  'LLM_PROXY_API_KEY',
  'LLM_PROXY_BASE_URL',
  'LLM_PROXY_MODEL_LARGE',
  'LLM_PROXY_MODEL_MEDIUM',
  'LLM_PROXY_MODEL_SMALL',
  'LLM_PROXY_HTTP_REFERER',
  'LLM_PROXY_X_TITLE',
  'LLM_PROXY_ANTHROPIC_BASE_URL',
] as const;

type EnvSnapshot = Partial<Record<typeof ENV_KEYS[number], string | undefined>>;
let envSnapshot: EnvSnapshot = {};

beforeEach(() => {
  // Save originals
  for (const k of ENV_KEYS) {
    envSnapshot[k] = process.env[k];
    delete process.env[k];
  }
});

afterEach(() => {
  // Restore originals
  for (const k of ENV_KEYS) {
    if (envSnapshot[k] === undefined) {
      delete process.env[k];
    } else {
      process.env[k] = envSnapshot[k];
    }
  }
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// 1. resolveLlmProxyApiKey()
// ---------------------------------------------------------------------------

describe('resolveLlmProxyApiKey()', () => {
  it('returns OPENROUTER_API_KEY when set', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-real';
    process.env.LLM_PROXY_API_KEY = 'fallback';
    expect(resolveLlmProxyApiKey()).toBe('sk-or-v1-real');
  });

  it('falls back to LLM_PROXY_API_KEY when OPENROUTER_API_KEY is absent', () => {
    process.env.LLM_PROXY_API_KEY = 'sk-fallback-key';
    expect(resolveLlmProxyApiKey()).toBe('sk-fallback-key');
  });

  it('returns empty string when neither key is set', () => {
    expect(resolveLlmProxyApiKey()).toBe('');
  });

  it('returns empty string for the placeholder value', () => {
    process.env.OPENROUTER_API_KEY = 'your-anthropic-api-key';
    expect(resolveLlmProxyApiKey()).toBe('');
  });

  it('accepts any non-placeholder non-empty string (no admin-key guard)', () => {
    // Previously sk-ant-admin keys were rejected; OpenRouter keys should not be.
    process.env.OPENROUTER_API_KEY = 'sk-ant-admin-abc123';
    expect(resolveLlmProxyApiKey()).toBe('sk-ant-admin-abc123');
  });
});

// ---------------------------------------------------------------------------
// 2. mapModel() — tested via forwardMessages body inspection
// ---------------------------------------------------------------------------

describe('mapModel() — League tier aliases', () => {
  it.each([
    ['league-large', 'LLM_PROXY_MODEL_LARGE', 'deepseek/deepseek-v4-pro'],
    ['large', 'LLM_PROXY_MODEL_LARGE', 'deepseek/deepseek-v4-pro'],
    ['opus', 'LLM_PROXY_MODEL_LARGE', 'deepseek/deepseek-v4-pro'],
    ['league-medium', 'LLM_PROXY_MODEL_MEDIUM', 'deepseek/deepseek-v4-flash'],
    ['medium', 'LLM_PROXY_MODEL_MEDIUM', 'deepseek/deepseek-v4-flash'],
    ['sonnet', 'LLM_PROXY_MODEL_MEDIUM', 'deepseek/deepseek-v4-flash'],
    ['league-small', 'LLM_PROXY_MODEL_SMALL', 'deepseek/deepseek-v3.2'],
    ['small', 'LLM_PROXY_MODEL_SMALL', 'deepseek/deepseek-v3.2'],
    ['haiku', 'LLM_PROXY_MODEL_SMALL', 'deepseek/deepseek-v3.2'],
  ])('maps "%s" → default %s (%s)', async (alias, _envKey, defaultModel) => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ model: alias, messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe(defaultModel);
  });

  it('maps tier aliases case-insensitively', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ model: 'SONNET', messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    // SONNET → medium tier
    expect(JSON.parse(init.body as string).model).toBe('deepseek/deepseek-v4-flash');
  });

  it('uses env-overridden model when LLM_PROXY_MODEL_LARGE is set', async () => {
    process.env.LLM_PROXY_MODEL_LARGE = 'custom/large-model';
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ model: 'league-large', messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe('custom/large-model');
  });

  it('maps unknown string to MEDIUM tier (cost-control default)', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ model: 'claude-unknown-model', messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe('deepseek/deepseek-v4-flash');
  });

  it.each([
    ['claude-opus-4-1-20250805', 'deepseek/deepseek-v4-pro'],
    ['claude-opus-4', 'deepseek/deepseek-v4-pro'],
    ['anthropic/claude-opus-4.1', 'deepseek/deepseek-v4-pro'],
    ['claude-sonnet-4-5-20250929', 'deepseek/deepseek-v4-flash'],
    ['claude-sonnet-4-5', 'deepseek/deepseek-v4-flash'],
    ['claude-3-7-sonnet-latest', 'deepseek/deepseek-v4-flash'],
    ['claude-haiku-4-5-20251001', 'deepseek/deepseek-v3.2'],
    ['claude-3-5-haiku-latest', 'deepseek/deepseek-v3.2'],
    ['Claude-HAIKU-4-5', 'deepseek/deepseek-v3.2'],
  ])('substring rule (sprint 003): "%s" → %s', (name, expected) => {
    expect(mapModel(name)).toBe(expected);
  });

  it('exact tier aliases win before the substring rule and unknown claude-* names fall to MEDIUM', () => {
    expect(mapModel('league-small')).toBe('deepseek/deepseek-v3.2');
    expect(mapModel('claude-unknown-model')).toBe('deepseek/deepseek-v4-flash');
    expect(mapModel('claude-3-opus-sonnet')).toBe('deepseek/deepseek-v4-pro'); // first rule to match wins
    expect(mapModel(undefined)).toBe('deepseek/deepseek-v4-flash');
    expect(mapModel(42)).toBe('deepseek/deepseek-v4-flash');
  });

  it('substring rule honours LLM_PROXY_MODEL_* overrides', () => {
    process.env.LLM_PROXY_MODEL_LARGE = 'custom/large-model';
    process.env.LLM_PROXY_MODEL_SMALL = 'custom/small-model';
    expect(mapModel('claude-opus-4-1')).toBe('custom/large-model');
    expect(mapModel('claude-haiku-4-5')).toBe('custom/small-model');
  });

  it('maps absent model to MEDIUM tier', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe('deepseek/deepseek-v4-flash');
  });
});

// ---------------------------------------------------------------------------
// 3. Non-streaming path
// ---------------------------------------------------------------------------

describe('forwardMessages — non-streaming', () => {
  it('uses LLM_PROXY_BASE_URL as the upstream URL', async () => {
    process.env.LLM_PROXY_BASE_URL = 'https://custom.endpoint.ai/v1/chat';
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://custom.endpoint.ai/v1/chat');
  });

  it('defaults to openrouter.ai when LLM_PROXY_BASE_URL is not set', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
  });

  it('sends Authorization: Bearer and no x-api-key or anthropic-version', async () => {
    const svc = new LlmProxyForwarderService('sk-or-v1-real');
    const req = makeFakeReq({ messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['authorization']).toBe('Bearer sk-or-v1-real');
    expect(init.headers['x-api-key']).toBeUndefined();
    expect(init.headers['anthropic-version']).toBeUndefined();
  });

  it('does not forward client Authorization header upstream', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({}, { authorization: 'Bearer llmp_student_token' });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    // Only server-side Bearer key, not the student token
    expect(init.headers['authorization']).toBe('Bearer sk-fake');
  });

  it('extracts usage from prompt_tokens / completion_tokens (OpenAI format)', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ messages: [] });
    const res = new FakeResponse();
    const responseBody = {
      id: 'chatcmpl-x',
      choices: [{ message: { role: 'assistant', content: 'hello' } }],
      usage: { prompt_tokens: 42, completion_tokens: 17 },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responseBody));
    globalThis.fetch = fetchMock as any;

    const usages: Array<[number, number]> = [];
    await svc.forwardMessages(req as any, res as any, {
      onUsage: (u) => usages.push([u.inputTokens, u.outputTokens]),
    });

    expect(usages).toEqual([[42, 17]]);
  });

  it('mirrors status, body, and content-type to the client', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ messages: [] });
    const res = new FakeResponse();
    const responseBody = { id: 'chatcmpl-y', usage: { prompt_tokens: 5, completion_tokens: 3 } };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responseBody));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(JSON.parse(res.sentBody!)).toEqual(responseBody);
  });

  it('reports zero tokens on upstream non-2xx', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(429, { error: 'rate limited' }));
    globalThis.fetch = fetchMock as any;

    const usages: Array<[number, number]> = [];
    await svc.forwardMessages(req as any, res as any, {
      onUsage: (u) => usages.push([u.inputTokens, u.outputTokens]),
    });
    expect(res.statusCode).toBe(429);
    expect(usages).toEqual([[0, 0]]);
  });

  it('returns 502 when fetch itself rejects (network failure)', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({});
    const res = new FakeResponse();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as any;

    let reported: [number, number] | null = null;
    await svc.forwardMessages(req as any, res as any, {
      onUsage: (u) => { reported = [u.inputTokens, u.outputTokens]; },
    });
    expect(res.statusCode).toBe(502);
    expect(reported).toEqual([0, 0]);
  });

  it('includes optional HTTP-Referer and X-Title headers when env vars are set', async () => {
    process.env.LLM_PROXY_HTTP_REFERER = 'https://league.example.com';
    process.env.LLM_PROXY_X_TITLE = 'League Student App';
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['HTTP-Referer']).toBe('https://league.example.com');
    expect(init.headers['X-Title']).toBe('League Student App');
  });
});

// ---------------------------------------------------------------------------
// 4. Streaming path
// ---------------------------------------------------------------------------

describe('forwardMessages — streaming', () => {
  it('injects stream_options: { include_usage: true } when body.stream === true', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true, messages: [] });
    const res = new FakeResponse();

    // Build a minimal SSE response with no usage data
    const doneFrame = 'data: [DONE]\n\n';
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([doneFrame]));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.stream_options).toEqual({ include_usage: true });
  });

  it('does NOT inject stream_options on non-streaming requests', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ messages: [] }); // no stream: true
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    const sentBody = JSON.parse(init.body as string);
    expect(sentBody.stream_options).toBeUndefined();
  });

  it('extracts usage from final SSE chunk prompt_tokens / completion_tokens', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true, messages: [] });
    const res = new FakeResponse();

    // Simulate OpenAI SSE: regular content delta, then final chunk with usage
    const contentFrame =
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        choices: [{ delta: { content: 'Hello' }, index: 0 }],
      })}\n\n`;
    const usageFrame =
      `data: ${JSON.stringify({
        id: 'chatcmpl-1',
        object: 'chat.completion.chunk',
        choices: [],
        usage: { prompt_tokens: 25, completion_tokens: 8 },
      })}\n\n`;
    const doneFrame = 'data: [DONE]\n\n';

    const fetchMock = vi
      .fn()
      .mockResolvedValue(sseResponse([contentFrame, usageFrame, doneFrame]));
    globalThis.fetch = fetchMock as any;

    let usage: [number, number] | null = null;
    await svc.forwardMessages(req as any, res as any, {
      onUsage: (u) => { usage = [u.inputTokens, u.outputTokens]; },
    });

    expect(usage).toEqual([25, 8]);
  });

  it('pipes all upstream bytes to the client verbatim', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true, messages: [] });
    const res = new FakeResponse();

    const frame1 = 'data: {"id":"c1","choices":[{"delta":{"content":"Hi"}}]}\n\n';
    const frame2 = 'data: {"id":"c1","choices":[],"usage":{"prompt_tokens":10,"completion_tokens":2}}\n\n';
    const doneFrame = 'data: [DONE]\n\n';

    const fetchMock = vi.fn().mockResolvedValue(sseResponse([frame1, frame2, doneFrame]));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });

    const combined = Buffer.concat(res.chunks).toString('utf8');
    expect(combined).toBe(frame1 + frame2 + doneFrame);
  });

  it('sets SSE response headers', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true, messages: [] });
    const res = new FakeResponse();

    const doneFrame = 'data: [DONE]\n\n';
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([doneFrame]));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');
  });

  it('streaming non-2xx falls back to JSON path', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true, messages: [] });
    const res = new FakeResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: 'bad key' }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.sentBody!).error).toBe('bad key');
  });

  it('calls onUsage with correct counts in streaming path', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true, messages: [] });
    const res = new FakeResponse();

    const usageFrame =
      `data: ${JSON.stringify({
        usage: { prompt_tokens: 100, completion_tokens: 50 },
      })}\n\n`;
    const doneFrame = 'data: [DONE]\n\n';

    const fetchMock = vi.fn().mockResolvedValue(sseResponse([usageFrame, doneFrame]));
    globalThis.fetch = fetchMock as any;

    let usage: [number, number] | null = null;
    await svc.forwardMessages(req as any, res as any, {
      onUsage: (u) => { usage = [u.inputTokens, u.outputTokens]; },
    });
    expect(usage).toEqual([100, 50]);
  });
});

// ---------------------------------------------------------------------------
// 5. Client disconnect — AbortController
// ---------------------------------------------------------------------------

describe('forwardMessages — client disconnect', () => {
  it('aborts the upstream fetch when the client disconnects', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true, messages: [] });
    const res = new FakeResponse();

    let signal: AbortSignal | undefined;
    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      signal = init.signal;
      // Never resolve — simulate a hung upstream.
      return new Promise((resolve, reject) => {
        signal?.addEventListener('abort', () => {
          const e = new Error('aborted') as any;
          e.name = 'AbortError';
          reject(e);
        });
      });
    }) as any;

    const fwd = svc.forwardMessages(req as any, res as any, {
      onUsage: () => {},
    });
    // Simulate client hang-up.
    res.emit('close');
    await fwd;

    expect(signal?.aborted).toBe(true);
  });

  it('ends the response cleanly after client disconnect', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true, messages: [] });
    const res = new FakeResponse();

    globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
      const s = init.signal as AbortSignal;
      return new Promise((_resolve, reject) => {
        s.addEventListener('abort', () => {
          const e = new Error('aborted') as any;
          e.name = 'AbortError';
          reject(e);
        });
      });
    }) as any;

    const fwd = svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    res.emit('close');
    await fwd;

    // Response should be ended (not in an indeterminate state)
    expect(res.writableEnded).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 6. isConfigured()
// ---------------------------------------------------------------------------

describe('isConfigured()', () => {
  it('returns true when a key is provided', () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    expect(svc.isConfigured()).toBe(true);
  });

  it('returns false when key is empty string', () => {
    const svc = new LlmProxyForwarderService('');
    expect(svc.isConfigured()).toBe(false);
  });

  it('returns false and throws LlmProxyNotConfiguredError on forwardMessages', async () => {
    const svc = new LlmProxyForwarderService('');
    const req = makeFakeReq({});
    const res = new FakeResponse();
    await expect(
      svc.forwardMessages(req as any, res as any, { onUsage: () => {} }),
    ).rejects.toThrow(LlmProxyNotConfiguredError);
  });

  it('resolves from OPENROUTER_API_KEY env var via default constructor', () => {
    process.env.OPENROUTER_API_KEY = 'sk-or-v1-test';
    const svc = new LlmProxyForwarderService();
    expect(svc.isConfigured()).toBe(true);
  });

  it('returns false when no key env vars are set', () => {
    // All env keys cleared in beforeEach
    const svc = new LlmProxyForwarderService();
    expect(svc.isConfigured()).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 7. Cost accounting (sprint 003) — usage.include, usage.cost, report shape
// ---------------------------------------------------------------------------

describe('forwardMessages — cost accounting (sprint 003)', () => {
  /** Run one forward and return the sent body plus the single usage report. */
  async function forward(body: any, upstream: any) {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq(body);
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    globalThis.fetch = fetchMock as any;
    const reports: UsageReport[] = [];
    await svc.forwardMessages(req as any, res as any, {
      onUsage: (u) => reports.push(u),
    });
    const [, init] = fetchMock.mock.calls[0];
    return { res, sentBody: JSON.parse(init.body as string), reports };
  }

  const sseUsageChunk = (usage: Record<string, unknown>) =>
    `data: ${JSON.stringify({ id: 'c1', object: 'chat.completion.chunk', choices: [], usage })}\n\n`;
  const sseContentChunk = 'data: {"id":"c1","choices":[{"delta":{"content":"Hi"}}]}\n\n';
  const doneFrame = 'data: [DONE]\n\n';

  it('injects usage: { include: true } on non-streaming requests', async () => {
    const { sentBody } = await forward({ messages: [] }, jsonResponse(200, { usage: {} }));
    expect(sentBody.usage).toEqual({ include: true });
    expect(sentBody.stream_options).toBeUndefined();
  });

  it('injects usage: { include: true } on streaming requests alongside stream_options', async () => {
    const { sentBody } = await forward({ stream: true, messages: [] }, sseResponse([doneFrame]));
    expect(sentBody.usage).toEqual({ include: true });
    expect(sentBody.stream_options).toEqual({ include_usage: true });
  });

  it('merges include: true into a client-supplied usage object without clobbering its fields', async () => {
    const { sentBody } = await forward(
      { messages: [], usage: { include: false, detail: 'full' } },
      jsonResponse(200, { usage: {} }),
    );
    expect(sentBody.usage).toEqual({ include: true, detail: 'full' });
  });

  it('replaces a non-object client usage value', async () => {
    const { sentBody } = await forward(
      { messages: [], usage: 'yes' },
      jsonResponse(200, { usage: {} }),
    );
    expect(sentBody.usage).toEqual({ include: true });
  });

  it('non-streaming: reports usage.cost from the JSON body', async () => {
    const { reports } = await forward(
      { messages: [] },
      jsonResponse(200, { usage: { prompt_tokens: 42, completion_tokens: 17, cost: 0.00123 } }),
    );
    expect(reports).toHaveLength(1);
    expect(reports[0].inputTokens).toBe(42);
    expect(reports[0].outputTokens).toBe(17);
    expect(reports[0].costUsd).toBe(0.00123);
  });

  it('non-streaming: costUsd is null when the body has no cost', async () => {
    const { reports } = await forward(
      { messages: [] },
      jsonResponse(200, { usage: { prompt_tokens: 42, completion_tokens: 17 } }),
    );
    expect(reports[0]).toMatchObject({ inputTokens: 42, outputTokens: 17, costUsd: null });
  });

  it('non-streaming: a non-numeric cost is reported as null', async () => {
    const { reports } = await forward(
      { messages: [] },
      jsonResponse(200, { usage: { prompt_tokens: 1, completion_tokens: 1, cost: '0.5' } }),
    );
    expect(reports[0].costUsd).toBeNull();
  });

  it('streaming: reports usage.cost from the final usage-bearing chunk', async () => {
    const { reports, res } = await forward(
      { stream: true, messages: [] },
      sseResponse([
        sseContentChunk,
        sseUsageChunk({ prompt_tokens: 25, completion_tokens: 8, cost: 0.0007 }),
        doneFrame,
      ]),
    );
    expect(reports).toHaveLength(1);
    expect(reports[0]).toMatchObject({ inputTokens: 25, outputTokens: 8, costUsd: 0.0007 });
    // Passthrough is untouched by the parsing.
    expect(Buffer.concat(res.chunks).toString('utf8')).toBe(
      sseContentChunk + sseUsageChunk({ prompt_tokens: 25, completion_tokens: 8, cost: 0.0007 }) + doneFrame,
    );
  });

  it('streaming: costUsd is null when no chunk carries a cost', async () => {
    const { reports } = await forward(
      { stream: true, messages: [] },
      sseResponse([sseUsageChunk({ prompt_tokens: 25, completion_tokens: 8 }), doneFrame]),
    );
    expect(reports[0]).toMatchObject({ inputTokens: 25, outputTokens: 8, costUsd: null });
  });

  it('report carries model requested/sent, protocol openai and the upstream status', async () => {
    const { reports } = await forward(
      { model: 'league-small', messages: [] },
      jsonResponse(200, { usage: { prompt_tokens: 3, completion_tokens: 4, cost: 0.1 } }),
    );
    expect(reports[0]).toEqual({
      inputTokens: 3,
      outputTokens: 4,
      costUsd: 0.1,
      modelRequested: 'league-small',
      modelSent: 'deepseek/deepseek-v3.2',
      protocol: 'openai',
      status: 200,
    });
  });

  it('modelRequested is null when the client sent no model', async () => {
    const { reports } = await forward({ messages: [] }, jsonResponse(200, { usage: {} }));
    expect(reports[0].modelRequested).toBeNull();
    expect(reports[0].modelSent).toBe('deepseek/deepseek-v4-flash');
  });

  it('upstream 4xx without usage reports the status with zero tokens and null cost', async () => {
    const { reports, res } = await forward(
      { model: 'league-large', messages: [] },
      jsonResponse(429, { error: 'rate limited' }),
    );
    expect(res.statusCode).toBe(429);
    expect(reports).toEqual([
      {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        modelRequested: 'league-large',
        modelSent: 'deepseek/deepseek-v4-pro',
        protocol: 'openai',
        status: 429,
      },
    ]);
  });

  it('upstream 5xx on a streaming request reports the status via the JSON fallback', async () => {
    const { reports } = await forward(
      { stream: true, messages: [] },
      jsonResponse(502, { error: 'upstream down' }),
    );
    expect(reports[0]).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: null, status: 502 });
  });

  it('fetch failure reports status 502 with zero tokens and null cost', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ model: 'sonnet', messages: [] });
    const res = new FakeResponse();
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as any;
    const reports: UsageReport[] = [];
    await svc.forwardMessages(req as any, res as any, { onUsage: (u) => reports.push(u) });
    expect(reports).toEqual([
      {
        inputTokens: 0,
        outputTokens: 0,
        costUsd: null,
        modelRequested: 'sonnet',
        modelSent: 'deepseek/deepseek-v4-flash',
        protocol: 'openai',
        status: 502,
      },
    ]);
  });
});

// ---------------------------------------------------------------------------
// 8. Anthropic path (sprint 003 ticket 003) — forwardAnthropicMessages
// ---------------------------------------------------------------------------

describe('forwardAnthropicMessages', () => {
  /** Run one Anthropic forward; return the fetch call, the response and the reports. */
  async function forwardA(
    body: any,
    upstream: any,
    headers: Record<string, string> = {},
    originalUrl = '/proxy/v1/messages',
  ) {
    const svc = new LlmProxyForwarderService('sk-or-v1-real');
    const req = { ...makeFakeReq(body, headers), originalUrl };
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(upstream);
    globalThis.fetch = fetchMock as any;
    const reports: UsageReport[] = [];
    await svc.forwardAnthropicMessages(req as any, res as any, {
      onUsage: (u) => reports.push(u),
    });
    const [url, init] = fetchMock.mock.calls[0] ?? [];
    return {
      res,
      url: url as string,
      init,
      sentBody: init ? JSON.parse(init.body as string) : null,
      reports,
    };
  }

  // Anthropic SSE fixture — the event sequence a real Messages stream emits.
  const sse = (type: string, payload: Record<string, unknown>) =>
    `event: ${type}\ndata: ${JSON.stringify({ type, ...payload })}\n\n`;
  const messageStart = (usage: Record<string, unknown>) =>
    sse('message_start', {
      message: {
        id: 'msg_01',
        type: 'message',
        role: 'assistant',
        model: 'deepseek/deepseek-v4-flash',
        content: [],
        stop_reason: null,
        usage,
      },
    });
  const contentBlockStart = sse('content_block_start', {
    index: 0,
    content_block: { type: 'text', text: '' },
  });
  const contentBlockDelta = (text: string) =>
    sse('content_block_delta', { index: 0, delta: { type: 'text_delta', text } });
  const contentBlockStop = sse('content_block_stop', { index: 0 });
  const messageDelta = (usage: Record<string, unknown>) =>
    sse('message_delta', { delta: { stop_reason: 'end_turn', stop_sequence: null }, usage });
  const messageStop = sse('message_stop', {});

  const anthropicJson = (usage: Record<string, unknown>) => ({
    id: 'msg_01',
    type: 'message',
    role: 'assistant',
    model: 'deepseek/deepseek-v4-flash',
    content: [{ type: 'text', text: 'Hello' }],
    stop_reason: 'end_turn',
    usage,
  });

  describe('upstream URL', () => {
    it("defaults to OpenRouter's Anthropic-compatible endpoint", async () => {
      const { url } = await forwardA({ messages: [] }, jsonResponse(200, anthropicJson({})));
      expect(url).toBe('https://openrouter.ai/api/v1/messages');
    });

    it('uses LLM_PROXY_ANTHROPIC_BASE_URL when set', async () => {
      process.env.LLM_PROXY_ANTHROPIC_BASE_URL = 'https://other.example/v1/messages';
      const { url } = await forwardA({ messages: [] }, jsonResponse(200, anthropicJson({})));
      expect(url).toBe('https://other.example/v1/messages');
    });

    it('carries the client query string across (passthrough)', async () => {
      const { url } = await forwardA(
        { messages: [] },
        jsonResponse(200, anthropicJson({})),
        {},
        '/proxy/v1/messages?beta=true',
      );
      expect(url).toBe('https://openrouter.ai/api/v1/messages?beta=true');
    });

    it('does not touch the OpenAI path URL', async () => {
      process.env.LLM_PROXY_ANTHROPIC_BASE_URL = 'https://other.example/v1/messages';
      const svc = new LlmProxyForwarderService('sk-fake');
      const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
      globalThis.fetch = fetchMock as any;
      await svc.forwardMessages(makeFakeReq({ messages: [] }) as any, new FakeResponse() as any, {
        onUsage: () => {},
      });
      expect(fetchMock.mock.calls[0][0]).toBe('https://openrouter.ai/api/v1/chat/completions');
    });
  });

  describe('headers', () => {
    it('authenticates upstream with Authorization: Bearer <OPENROUTER_API_KEY> and no x-api-key', async () => {
      const { init } = await forwardA(
        { messages: [] },
        jsonResponse(200, anthropicJson({})),
        { 'x-api-key': 'llmp_student', authorization: 'Bearer llmp_student' },
      );
      expect(init.headers['authorization']).toBe('Bearer sk-or-v1-real');
      expect(init.headers['x-api-key']).toBeUndefined();
      expect(init.headers['content-type']).toBe('application/json');
    });

    it('passes through anthropic-version and anthropic-beta from the client', async () => {
      const { init } = await forwardA({ messages: [] }, jsonResponse(200, anthropicJson({})), {
        'anthropic-version': '2024-10-22',
        'anthropic-beta': 'interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
      });
      expect(init.headers['anthropic-version']).toBe('2024-10-22');
      expect(init.headers['anthropic-beta']).toBe(
        'interleaved-thinking-2025-05-14,fine-grained-tool-streaming-2025-05-14',
      );
    });

    it('defaults anthropic-version to 2023-06-01 and omits anthropic-beta when the client sent none', async () => {
      const { init } = await forwardA({ messages: [] }, jsonResponse(200, anthropicJson({})));
      expect(init.headers['anthropic-version']).toBe('2023-06-01');
      expect(init.headers['anthropic-beta']).toBeUndefined();
    });

    it('includes the optional attribution headers when configured', async () => {
      process.env.LLM_PROXY_HTTP_REFERER = 'https://league.example.com';
      process.env.LLM_PROXY_X_TITLE = 'League Student App';
      const { init } = await forwardA({ messages: [] }, jsonResponse(200, anthropicJson({})));
      expect(init.headers['HTTP-Referer']).toBe('https://league.example.com');
      expect(init.headers['X-Title']).toBe('League Student App');
    });
  });

  describe('body', () => {
    it('rewrites only model: Claude Code names map to the League tier slug, everything else is unchanged', async () => {
      const body = {
        model: 'claude-sonnet-4-5-20250929',
        max_tokens: 1024,
        stream: false,
        system: 'You are terse.',
        messages: [{ role: 'user', content: 'hi' }],
        metadata: { user_id: 'abc' },
      };
      const { sentBody } = await forwardA(body, jsonResponse(200, anthropicJson({})));
      expect(sentBody).toEqual({ ...body, model: 'deepseek/deepseek-v4-flash' });
      expect(sentBody.usage).toBeUndefined();
      expect(sentBody.stream_options).toBeUndefined();
    });

    it('does not inject usage.include or stream_options on streaming requests either', async () => {
      const { sentBody } = await forwardA(
        { model: 'league-large', stream: true, max_tokens: 10, messages: [] },
        sseResponse([messageStart({ input_tokens: 1, output_tokens: 1 }), messageStop]),
      );
      expect(sentBody).toEqual({
        model: 'deepseek/deepseek-v4-pro',
        stream: true,
        max_tokens: 10,
        messages: [],
      });
    });

    it.each([
      ['claude-opus-4-1-20250805', 'deepseek/deepseek-v4-pro'],
      ['claude-haiku-4-5-20251001', 'deepseek/deepseek-v3.2'],
      ['league-medium', 'deepseek/deepseek-v4-flash'],
    ])('maps %s → %s', async (name, expected) => {
      const { sentBody, reports } = await forwardA(
        { model: name, messages: [] },
        jsonResponse(200, anthropicJson({})),
      );
      expect(sentBody.model).toBe(expected);
      expect(reports[0]).toMatchObject({ modelRequested: name, modelSent: expected });
    });
  });

  describe('non-streaming usage', () => {
    it('reads usage.input_tokens / usage.output_tokens and reports protocol anthropic', async () => {
      const { reports, res } = await forwardA(
        { model: 'league-small', messages: [] },
        jsonResponse(200, anthropicJson({ input_tokens: 42, output_tokens: 17 })),
      );
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('application/json');
      expect(JSON.parse(res.sentBody!)).toEqual(
        anthropicJson({ input_tokens: 42, output_tokens: 17 }),
      );
      expect(reports).toEqual([
        {
          inputTokens: 42,
          outputTokens: 17,
          costUsd: null,
          modelRequested: 'league-small',
          modelSent: 'deepseek/deepseek-v3.2',
          protocol: 'anthropic',
          status: 200,
        },
      ]);
    });

    it('reports usage.cost when OpenRouter includes it', async () => {
      const { reports } = await forwardA(
        { messages: [] },
        jsonResponse(200, anthropicJson({ input_tokens: 42, output_tokens: 17, cost: 0.00042 })),
      );
      expect(reports[0]).toMatchObject({ inputTokens: 42, outputTokens: 17, costUsd: 0.00042 });
    });

    it('a non-numeric cost is reported as null', async () => {
      const { reports } = await forwardA(
        { messages: [] },
        jsonResponse(200, anthropicJson({ input_tokens: 1, output_tokens: 1, cost: '0.5' })),
      );
      expect(reports[0].costUsd).toBeNull();
    });

    it('mirrors an upstream error (status, body) and reports zero tokens with that status', async () => {
      const errorBody = {
        type: 'error',
        error: { type: 'authentication_error', message: 'bad key' },
      };
      const { reports, res } = await forwardA(
        { model: 'claude-opus-4', messages: [] },
        jsonResponse(401, errorBody),
      );
      expect(res.statusCode).toBe(401);
      expect(JSON.parse(res.sentBody!)).toEqual(errorBody);
      expect(reports).toEqual([
        {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
          modelRequested: 'claude-opus-4',
          modelSent: 'deepseek/deepseek-v4-pro',
          protocol: 'anthropic',
          status: 401,
        },
      ]);
    });
  });

  describe('streaming usage', () => {
    const fullStream = [
      messageStart({ input_tokens: 25, output_tokens: 1 }),
      contentBlockStart,
      contentBlockDelta('Hel'),
      contentBlockDelta('lo'),
      contentBlockStop,
      messageDelta({ output_tokens: 8 }),
      messageStop,
    ];

    it('takes input_tokens from message_start and output_tokens from the last message_delta', async () => {
      const { reports } = await forwardA({ stream: true, messages: [] }, sseResponse(fullStream));
      expect(reports).toEqual([
        {
          inputTokens: 25,
          outputTokens: 8,
          costUsd: null,
          modelRequested: null,
          modelSent: 'deepseek/deepseek-v4-flash',
          protocol: 'anthropic',
          status: 200,
        },
      ]);
    });

    it('the last message_delta wins (cumulative output_tokens) and carries cost when present', async () => {
      const { reports } = await forwardA(
        { stream: true, messages: [] },
        sseResponse([
          messageStart({ input_tokens: 30, output_tokens: 2 }),
          contentBlockDelta('a'),
          messageDelta({ output_tokens: 5 }),
          contentBlockDelta('b'),
          messageDelta({ output_tokens: 12, cost: 0.0009 }),
          messageStop,
        ]),
      );
      expect(reports[0]).toMatchObject({ inputTokens: 30, outputTokens: 12, costUsd: 0.0009 });
    });

    it('pipes every upstream byte verbatim and sets SSE headers', async () => {
      const { res } = await forwardA({ stream: true, messages: [] }, sseResponse(fullStream));
      expect(Buffer.concat(res.chunks).toString('utf8')).toBe(fullStream.join(''));
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toBe('text/event-stream; charset=utf-8');
      expect(res.headers['cache-control']).toBe('no-cache, no-transform');
      expect(res.writableEnded).toBe(true);
    });

    it('parses events split across chunk boundaries', async () => {
      const whole = fullStream.join('');
      // Cut in the middle of the message_delta JSON.
      const cut = whole.indexOf('"output_tokens":8') + 6;
      const chunks = [whole.slice(0, 40), whole.slice(40, cut), whole.slice(cut)];
      const { reports, res } = await forwardA({ stream: true, messages: [] }, sseResponse(chunks));
      expect(reports[0]).toMatchObject({ inputTokens: 25, outputTokens: 8 });
      expect(Buffer.concat(res.chunks).toString('utf8')).toBe(whole);
    });

    it('ignores content_block_delta and message_stop for accounting', async () => {
      const { reports } = await forwardA(
        { stream: true, messages: [] },
        sseResponse([contentBlockDelta('x'), messageStop]),
      );
      expect(reports[0]).toMatchObject({ inputTokens: 0, outputTokens: 0, costUsd: null });
    });

    it('a streaming request that fails upstream falls back to the JSON path with the status', async () => {
      const { reports, res } = await forwardA(
        { stream: true, messages: [] },
        jsonResponse(529, { type: 'error', error: { type: 'overloaded_error', message: 'busy' } }),
      );
      expect(res.statusCode).toBe(529);
      expect(reports[0]).toMatchObject({ inputTokens: 0, outputTokens: 0, status: 529, protocol: 'anthropic' });
    });
  });

  describe('failure modes', () => {
    it('throws LlmProxyNotConfiguredError without an API key', async () => {
      const svc = new LlmProxyForwarderService('');
      await expect(
        svc.forwardAnthropicMessages(makeFakeReq({}) as any, new FakeResponse() as any, {
          onUsage: () => {},
        }),
      ).rejects.toThrow(LlmProxyNotConfiguredError);
    });

    it('returns 502 and reports status 502 / protocol anthropic when fetch rejects', async () => {
      const svc = new LlmProxyForwarderService('sk-fake');
      const res = new FakeResponse();
      globalThis.fetch = vi.fn().mockRejectedValue(new Error('boom')) as any;
      const reports: UsageReport[] = [];
      await svc.forwardAnthropicMessages(
        makeFakeReq({ model: 'claude-haiku-4-5', messages: [] }) as any,
        res as any,
        { onUsage: (u) => reports.push(u) },
      );
      expect(res.statusCode).toBe(502);
      expect(reports).toEqual([
        {
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
          modelRequested: 'claude-haiku-4-5',
          modelSent: 'deepseek/deepseek-v3.2',
          protocol: 'anthropic',
          status: 502,
        },
      ]);
    });

    it('aborts the upstream fetch when the client disconnects', async () => {
      const svc = new LlmProxyForwarderService('sk-fake');
      const res = new FakeResponse();
      let signal: AbortSignal | undefined;
      globalThis.fetch = vi.fn().mockImplementation((_url, init) => {
        signal = init.signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener('abort', () => {
            const e = new Error('aborted') as any;
            e.name = 'AbortError';
            reject(e);
          });
        });
      }) as any;
      const fwd = svc.forwardAnthropicMessages(
        makeFakeReq({ stream: true, messages: [] }) as any,
        res as any,
        { onUsage: () => {} },
      );
      res.emit('close');
      await fwd;
      expect(signal?.aborted).toBe(true);
      expect(res.writableEnded).toBe(true);
    });
  });
});
