/**
 * Unit tests for LlmProxyForwarderService (Sprint 013 T003).
 *
 * Mocks the global `fetch` so we can exercise the non-streaming and
 * streaming paths end-to-end without a real Anthropic account.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { EventEmitter } from 'node:events';
import {
  LlmProxyForwarderService,
  LlmProxyNotConfiguredError,
  resolveLlmProxyApiKey,
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
// Setup
// ---------------------------------------------------------------------------

const originalFetch = globalThis.fetch;
const originalEnvKey = process.env.ANTHROPIC_API_KEY;
const originalLlmKey = process.env.LLM_PROXY_ANTHROPIC_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalEnvKey === undefined) delete process.env.ANTHROPIC_API_KEY;
  else process.env.ANTHROPIC_API_KEY = originalEnvKey;
  if (originalLlmKey === undefined) delete process.env.LLM_PROXY_ANTHROPIC_API_KEY;
  else process.env.LLM_PROXY_ANTHROPIC_API_KEY = originalLlmKey;
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Construction
// ---------------------------------------------------------------------------

describe('LlmProxyForwarderService — configuration', () => {
  it('isConfigured=true when key is provided', () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    expect(svc.isConfigured()).toBe(true);
  });

  it('isConfigured=false when key is empty', () => {
    const svc = new LlmProxyForwarderService('');
    expect(svc.isConfigured()).toBe(false);
  });

  it('throws LlmProxyNotConfiguredError when forwarding with empty key', async () => {
    const svc = new LlmProxyForwarderService('');
    const req = makeFakeReq({});
    const res = new FakeResponse();
    await expect(
      svc.forwardMessages(req as any, res as any, { onUsage: () => {} }),
    ).rejects.toThrow(LlmProxyNotConfiguredError);
  });

  it('resolveLlmProxyApiKey prefers LLM_PROXY_ANTHROPIC_API_KEY', () => {
    process.env.LLM_PROXY_ANTHROPIC_API_KEY = 'llm-key';
    process.env.ANTHROPIC_API_KEY = 'fallback-key';
    expect(resolveLlmProxyApiKey()).toBe('llm-key');
  });

  it('resolveLlmProxyApiKey falls back to ANTHROPIC_API_KEY', () => {
    delete process.env.LLM_PROXY_ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = 'fallback-key';
    expect(resolveLlmProxyApiKey()).toBe('fallback-key');
  });

  it('resolveLlmProxyApiKey returns empty string when neither is set', () => {
    delete process.env.LLM_PROXY_ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;
    expect(resolveLlmProxyApiKey()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Non-streaming
// ---------------------------------------------------------------------------

describe('LlmProxyForwarderService.forwardMessages — non-streaming', () => {
  it('mirrors status, body, content-type, and reports usage', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({
      model: 'claude-3-5-haiku-latest',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 10,
    });
    const res = new FakeResponse();

    const responseBody = {
      id: 'msg_x',
      content: [{ type: 'text', text: 'hello' }],
      usage: { input_tokens: 12, output_tokens: 34 },
    };
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, responseBody));
    globalThis.fetch = fetchMock as any;

    const usages: Array<[number, number]> = [];
    await svc.forwardMessages(req as any, res as any, {
      onUsage: (i, o) => usages.push([i, o]),
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0];
    expect(init.method).toBe('POST');
    expect(init.headers['x-api-key']).toBe('sk-fake');
    expect(init.headers['anthropic-version']).toBe('2023-06-01');
    expect(typeof init.body).toBe('string');
    // Model is mapped: "haiku" in the string → claude-haiku-4-5-20251001
    expect(JSON.parse(init.body as string).model).toBe(
      'claude-haiku-4-5-20251001',
    );

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe('application/json');
    expect(JSON.parse(res.sentBody!)).toEqual(responseBody);
    expect(usages).toEqual([[12, 34]]);
  });

  it('passes through the anthropic-beta header when supplied', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({}, { 'anthropic-beta': 'tool-use-2024-04' });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['anthropic-beta']).toBe('tool-use-2024-04');
  });

  it('strips client-supplied authorization / x-api-key headers', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq(
      {},
      {
        authorization: 'Bearer llmp_student_token',
        'x-api-key': 'sk-evil-override',
      },
    );
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    // Only the server key is set.
    expect(init.headers['x-api-key']).toBe('sk-fake');
    expect(init.headers['authorization']).toBeUndefined();
  });

  it('reports zero tokens on upstream failure', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({});
    const res = new FakeResponse();
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse(429, { error: 'rate limited' }));
    globalThis.fetch = fetchMock as any;

    const usages: Array<[number, number]> = [];
    await svc.forwardMessages(req as any, res as any, {
      onUsage: (i, o) => usages.push([i, o]),
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
      onUsage: (i, o) => {
        reported = [i, o];
      },
    });
    expect(res.statusCode).toBe(502);
    expect(reported).toEqual([0, 0]);
  });

  // Model mapping tests
  it('maps any model string containing "sonnet" (case-insensitive) to claude-sonnet-4-6', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({
      model: 'Claude-Sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe('claude-sonnet-4-6');
  });

  it('maps any model string containing "haiku" (case-insensitive) to claude-haiku-4-5-20251001', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({
      model: 'haiku-rumba-jumba',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe(
      'claude-haiku-4-5-20251001',
    );
  });

  it('defaults unknown models to claude-sonnet-4-6', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({
      model: 'claude-unknown-model',
      messages: [{ role: 'user', content: 'hi' }],
    });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe('claude-sonnet-4-6');
  });

  it('defaults missing model to claude-sonnet-4-6', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({
      messages: [{ role: 'user', content: 'hi' }],
    });
    const res = new FakeResponse();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { usage: {} }));
    globalThis.fetch = fetchMock as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse(init.body as string).model).toBe('claude-sonnet-4-6');
  });
});

// ---------------------------------------------------------------------------
// Streaming
// ---------------------------------------------------------------------------

describe('LlmProxyForwarderService.forwardMessages — streaming', () => {
  it('streams bytes as they arrive and accumulates usage from message_delta', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true });
    const res = new FakeResponse();

    const startFrame =
      'event: message_start\n' +
      `data: ${JSON.stringify({
        type: 'message_start',
        message: { id: 'msg_1', usage: { input_tokens: 17, output_tokens: 0 } },
      })}\n\n`;
    const deltaFrame1 =
      'event: message_delta\n' +
      `data: ${JSON.stringify({
        type: 'message_delta',
        usage: { output_tokens: 5 },
      })}\n\n`;
    const deltaFrame2 =
      'event: message_delta\n' +
      `data: ${JSON.stringify({
        type: 'message_delta',
        usage: { output_tokens: 12 },
      })}\n\n`;
    const doneFrame = 'event: message_stop\ndata: [DONE]\n\n';

    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(
        sseResponse([startFrame, deltaFrame1, deltaFrame2, doneFrame]),
      ) as any;

    let usage: [number, number] | null = null;
    await svc.forwardMessages(req as any, res as any, {
      onUsage: (i, o) => {
        usage = [i, o];
      },
    });

    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toBe(
      'text/event-stream; charset=utf-8',
    );
    expect(res.headers['cache-control']).toBe('no-cache, no-transform');

    // All upstream bytes were written to the client verbatim.
    const combined = Buffer.concat(res.chunks).toString('utf8');
    expect(combined).toBe(startFrame + deltaFrame1 + deltaFrame2 + doneFrame);

    // Usage reflects input_tokens from message_start and the last
    // message_delta's output_tokens (cumulative in Anthropic's API).
    expect(usage).toEqual([17, 12]);
  });

  it('streaming with a non-2xx upstream falls back to the JSON path', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true });
    const res = new FakeResponse();
    globalThis.fetch = vi
      .fn()
      .mockResolvedValue(jsonResponse(401, { error: 'bad key' })) as any;

    await svc.forwardMessages(req as any, res as any, { onUsage: () => {} });
    expect(res.statusCode).toBe(401);
    expect(JSON.parse(res.sentBody!).error).toBe('bad key');
  });

  it('aborts the upstream fetch when the client disconnects', async () => {
    const svc = new LlmProxyForwarderService('sk-fake');
    const req = makeFakeReq({ stream: true });
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
    // Simulate a client hang-up.
    res.emit('close');
    await fwd;

    expect(signal?.aborted).toBe(true);
  });
});
