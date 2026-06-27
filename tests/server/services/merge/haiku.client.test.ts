/**
 * Unit tests for HaikuClientImpl and FakeHaikuClient.
 * Sprint 007, T002. Updated Sprint 001, ticket 005: mocks switched from
 * Anthropic SDK to fetch (OpenAI Chat Completions format).
 *
 * Covers:
 *  - HaikuApiError and HaikuParseError: correct name, message, properties
 *  - HaikuClientImpl.evaluate: successful evaluation from a mocked fetch response
 *  - HaikuClientImpl.evaluate: throws HaikuApiError when fetch throws (network error)
 *  - HaikuClientImpl.evaluate: throws HaikuApiError when the API returns non-2xx
 *  - HaikuClientImpl.evaluate: throws HaikuParseError when response text is not valid JSON
 *  - HaikuClientImpl.evaluate: throws HaikuParseError when JSON is missing the confidence field
 *  - FakeHaikuClient: records calls, returns defaults, supports configure/configureError/reset
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  HaikuClientImpl,
  HaikuApiError,
  HaikuParseError,
} from '../../../../server/src/services/merge/haiku.client.js';
import { FakeHaikuClient } from '../../helpers/fake-haiku.client.js';
import type { UserSnapshot } from '../../../../server/src/services/merge/haiku.client.js';

// ---------------------------------------------------------------------------
// Test fixtures
// ---------------------------------------------------------------------------

const userA: UserSnapshot = {
  id: 1,
  display_name: 'Alice Smith',
  primary_email: 'alice@example.com',
  pike13_id: 'p13-001',
  cohort_name: 'Spring 2024',
  created_via: 'google_oauth',
  created_at: '2024-01-15T10:00:00.000Z',
};

const userB: UserSnapshot = {
  id: 2,
  display_name: 'Alice Smith',
  primary_email: 'alice.smith@students.jointheleague.org',
  pike13_id: null,
  cohort_name: 'Spring 2024',
  created_via: 'pike13_sync',
  created_at: '2024-01-16T09:00:00.000Z',
};

// ---------------------------------------------------------------------------
// Helpers — build a mock OpenRouter (OpenAI Chat Completions) fetch response
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock OpenAI Chat Completions response carrying the given text.
 */
function mockOpenRouterResponse(text: string): object {
  return {
    id: 'chatcmpl_test',
    object: 'chat.completion',
    created: 1700000000,
    model: 'deepseek/deepseek-v3.2',
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: text,
        },
        finish_reason: 'stop',
      },
    ],
    usage: {
      prompt_tokens: 100,
      completion_tokens: 50,
      total_tokens: 150,
    },
  };
}

/**
 * Create a mock fetch that resolves to a 200 response with the given JSON body.
 */
function mockFetchOk(responseBody: object): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: vi.fn().mockResolvedValue(responseBody),
    text: vi.fn().mockResolvedValue(JSON.stringify(responseBody)),
  } as unknown as Response);
}

/**
 * Create a mock fetch that resolves to a non-2xx response.
 */
function mockFetchError(status: number, body: string): ReturnType<typeof vi.fn> {
  return vi.fn().mockResolvedValue({
    ok: false,
    status,
    json: vi.fn().mockRejectedValue(new Error('not json')),
    text: vi.fn().mockResolvedValue(body),
  } as unknown as Response);
}

/**
 * Create a mock fetch that rejects with a network error.
 */
function mockFetchNetworkError(err: Error): ReturnType<typeof vi.fn> {
  return vi.fn().mockRejectedValue(err);
}

// ---------------------------------------------------------------------------
// HaikuApiError — unit tests
// ---------------------------------------------------------------------------

describe('HaikuApiError', () => {
  it('has correct name and message', () => {
    const err = new HaikuApiError('API failed');
    expect(err.name).toBe('HaikuApiError');
    expect(err.message).toBe('API failed');
    expect(err).toBeInstanceOf(Error);
  });

  it('stores cause when provided', () => {
    const cause = new Error('root cause');
    const err = new HaikuApiError('wrapped', cause);
    expect(err.cause).toBe(cause);
  });

  it('cause is undefined when not provided', () => {
    const err = new HaikuApiError('no cause');
    expect(err.cause).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HaikuParseError — unit tests
// ---------------------------------------------------------------------------

describe('HaikuParseError', () => {
  it('has correct name and stores rawText', () => {
    const err = new HaikuParseError('bad json', 'not-json-text');
    expect(err.name).toBe('HaikuParseError');
    expect(err.message).toBe('bad json');
    expect(err.rawText).toBe('not-json-text');
    expect(err).toBeInstanceOf(Error);
  });

  it('stores cause when provided', () => {
    const cause = new SyntaxError('unexpected token');
    const err = new HaikuParseError('parse failed', 'bad', cause);
    expect(err.cause).toBe(cause);
  });

  it('cause is undefined when not provided', () => {
    const err = new HaikuParseError('no cause', 'raw');
    expect(err.cause).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// HaikuClientImpl — evaluate success path
// ---------------------------------------------------------------------------

describe('HaikuClientImpl.evaluate — success', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns { confidence, rationale } from a valid OpenRouter response', async () => {
    const validResponse = JSON.stringify({
      confidence: 0.85,
      rationale: 'Same name and cohort, different email domains.',
    });

    vi.stubGlobal('fetch', mockFetchOk(mockOpenRouterResponse(validResponse)));

    const client = new HaikuClientImpl('test-key');
    const result = await client.evaluate(userA, userB);
    expect(result.confidence).toBe(0.85);
    expect(result.rationale).toBe('Same name and cohort, different email domains.');
    expect(fetch).toHaveBeenCalledOnce();
  });

  it('clamps confidence > 1.0 to 1.0', async () => {
    const overflowResponse = JSON.stringify({ confidence: 1.5, rationale: 'Overflow test.' });
    vi.stubGlobal('fetch', mockFetchOk(mockOpenRouterResponse(overflowResponse)));

    const client = new HaikuClientImpl('test-key');
    const result = await client.evaluate(userA, userB);
    expect(result.confidence).toBe(1.0);
  });

  it('clamps confidence < 0.0 to 0.0', async () => {
    const underflowResponse = JSON.stringify({ confidence: -0.3, rationale: 'Underflow test.' });
    vi.stubGlobal('fetch', mockFetchOk(mockOpenRouterResponse(underflowResponse)));

    const client = new HaikuClientImpl('test-key');
    const result = await client.evaluate(userA, userB);
    expect(result.confidence).toBe(0.0);
  });

  it('sends fetch POST with correct URL, headers, and body', async () => {
    const validResponse = JSON.stringify({ confidence: 0.7, rationale: 'Similar.' });
    const mockFn = mockFetchOk(mockOpenRouterResponse(validResponse));
    vi.stubGlobal('fetch', mockFn);

    const client = new HaikuClientImpl('test-key');
    await client.evaluate(userA, userB);

    expect(mockFn).toHaveBeenCalledOnce();
    const [url, init] = mockFn.mock.calls[0] as [string, RequestInit];
    // URL should be the default OpenRouter endpoint
    expect(url).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>)['Authorization']).toBe('Bearer test-key');
    expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');

    const parsedBody = JSON.parse(init.body as string) as {
      max_tokens: number;
      messages: Array<{ role: string; content: string }>;
    };
    expect(parsedBody.max_tokens).toBe(256);
    // System message comes first in OpenAI Chat format
    expect(parsedBody.messages[0].role).toBe('system');
    // User message carries both users' content
    const userMessage = parsedBody.messages[1].content;
    expect(userMessage).toContain('Alice Smith');
    expect(userMessage).toContain('alice@example.com');
    expect(userMessage).toContain('alice.smith@students.jointheleague.org');
    expect(userMessage).toContain('p13-001');
    expect(userMessage).toContain('Spring 2024');
  });
});

// ---------------------------------------------------------------------------
// HaikuClientImpl — HaikuApiError path
// ---------------------------------------------------------------------------

describe('HaikuClientImpl.evaluate — HaikuApiError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws HaikuApiError when fetch throws (network error)', async () => {
    const networkError = new Error('Network error');
    vi.stubGlobal('fetch', mockFetchNetworkError(networkError));

    const client = new HaikuClientImpl('test-key');
    await expect(client.evaluate(userA, userB)).rejects.toThrow(HaikuApiError);
    await expect(client.evaluate(userA, userB)).rejects.not.toThrow(HaikuParseError);
  });

  it('wraps the original network error as cause', async () => {
    const networkError = new Error('Rate limited');
    vi.stubGlobal('fetch', mockFetchNetworkError(networkError));

    const client = new HaikuClientImpl('test-key');

    try {
      await client.evaluate(userA, userB);
      expect.fail('Expected HaikuApiError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HaikuApiError);
      expect((err as HaikuApiError).cause).toBe(networkError);
    }
  });

  it('throws HaikuApiError when the API returns non-2xx status', async () => {
    vi.stubGlobal('fetch', mockFetchError(429, 'Too Many Requests'));

    const client = new HaikuClientImpl('test-key');
    await expect(client.evaluate(userA, userB)).rejects.toThrow(HaikuApiError);
  });

  it('includes the HTTP status in the HaikuApiError message for non-2xx', async () => {
    vi.stubGlobal('fetch', mockFetchError(503, 'Service Unavailable'));

    const client = new HaikuClientImpl('test-key');

    try {
      await client.evaluate(userA, userB);
      expect.fail('Expected HaikuApiError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HaikuApiError);
      expect((err as HaikuApiError).message).toContain('503');
    }
  });
});

// ---------------------------------------------------------------------------
// HaikuClientImpl — HaikuParseError path
// ---------------------------------------------------------------------------

describe('HaikuClientImpl.evaluate — HaikuParseError', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('throws HaikuParseError when the response content is not valid JSON', async () => {
    vi.stubGlobal('fetch', mockFetchOk(mockOpenRouterResponse('This is not JSON at all.')));

    const client = new HaikuClientImpl('test-key');
    await expect(client.evaluate(userA, userB)).rejects.toThrow(HaikuParseError);
  });

  it('stores the raw text on HaikuParseError for diagnostics', async () => {
    const rawText = 'definitely not json { broken';
    vi.stubGlobal('fetch', mockFetchOk(mockOpenRouterResponse(rawText)));

    const client = new HaikuClientImpl('test-key');

    try {
      await client.evaluate(userA, userB);
      expect.fail('Expected HaikuParseError');
    } catch (err) {
      expect(err).toBeInstanceOf(HaikuParseError);
      expect((err as HaikuParseError).rawText).toBe(rawText);
    }
  });

  it('throws HaikuParseError when JSON is missing the confidence field', async () => {
    const noConfidence = JSON.stringify({ rationale: 'No confidence here.' });
    vi.stubGlobal('fetch', mockFetchOk(mockOpenRouterResponse(noConfidence)));

    const client = new HaikuClientImpl('test-key');
    await expect(client.evaluate(userA, userB)).rejects.toThrow(HaikuParseError);
    await expect(client.evaluate(userA, userB)).rejects.not.toThrow(HaikuApiError);
  });

  it('throws HaikuParseError when JSON is missing the rationale field', async () => {
    const noRationale = JSON.stringify({ confidence: 0.8 });
    vi.stubGlobal('fetch', mockFetchOk(mockOpenRouterResponse(noRationale)));

    const client = new HaikuClientImpl('test-key');
    await expect(client.evaluate(userA, userB)).rejects.toThrow(HaikuParseError);
  });

  it('throws HaikuParseError when choices[0].message.content is missing', async () => {
    const emptyChoicesResponse = {
      id: 'chatcmpl_test',
      object: 'chat.completion',
      choices: [],
    };
    vi.stubGlobal('fetch', mockFetchOk(emptyChoicesResponse));

    const client = new HaikuClientImpl('test-key');
    await expect(client.evaluate(userA, userB)).rejects.toThrow(HaikuParseError);
  });
});

// ---------------------------------------------------------------------------
// FakeHaikuClient — unit tests
// ---------------------------------------------------------------------------

describe('FakeHaikuClient', () => {
  let fake: FakeHaikuClient;

  beforeEach(() => {
    fake = new FakeHaikuClient();
  });

  describe('default behaviour', () => {
    it('returns default result and records the call', async () => {
      const result = await fake.evaluate(userA, userB);
      expect(result.confidence).toBe(0.5);
      expect(result.rationale).toBe('Fake evaluation result.');
      expect(fake.calls).toHaveLength(1);
      expect(fake.calls[0].userA).toBe(userA);
      expect(fake.calls[0].userB).toBe(userB);
    });

    it('records multiple calls in order', async () => {
      await fake.evaluate(userA, userB);
      await fake.evaluate(userB, userA);
      expect(fake.calls).toHaveLength(2);
      expect(fake.calls[0].userA.id).toBe(1);
      expect(fake.calls[1].userA.id).toBe(2);
    });
  });

  describe('configure()', () => {
    it('overrides the return value', async () => {
      const custom = { confidence: 0.92, rationale: 'Almost certainly the same person.' };
      fake.configure(custom);
      const result = await fake.evaluate(userA, userB);
      expect(result).toEqual(custom);
    });
  });

  describe('configureError()', () => {
    it('makes evaluate throw the configured error', async () => {
      const err = new HaikuApiError('API down');
      fake.configureError(err);
      await expect(fake.evaluate(userA, userB)).rejects.toThrow(err);
      // Call is still recorded even when it throws
      expect(fake.calls).toHaveLength(1);
    });

    it('can be configured to throw HaikuParseError', async () => {
      const err = new HaikuParseError('bad response', 'raw');
      fake.configureError(err);
      await expect(fake.evaluate(userA, userB)).rejects.toThrow(HaikuParseError);
    });
  });

  describe('reset()', () => {
    it('clears recorded calls and configured overrides', async () => {
      await fake.evaluate(userA, userB);
      fake.configure({ confidence: 0.99, rationale: 'Override.' });
      fake.configureError(new HaikuApiError('error'));

      fake.reset();

      expect(fake.calls).toHaveLength(0);

      // After reset, default applies again
      const result = await fake.evaluate(userA, userB);
      expect(result.confidence).toBe(0.5);

      // After reset, error override is cleared — does not throw
      await expect(fake.evaluate(userA, userB)).resolves.toBeDefined();
    });
  });
});
