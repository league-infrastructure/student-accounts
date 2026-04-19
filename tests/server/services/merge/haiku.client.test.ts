/**
 * Unit tests for HaikuClientImpl and FakeHaikuClient.
 * Sprint 007, T002.
 *
 * Covers:
 *  - HaikuApiError and HaikuParseError: correct name, message, properties
 *  - HaikuClientImpl.evaluate: successful evaluation from a mocked Anthropic SDK response
 *  - HaikuClientImpl.evaluate: throws HaikuApiError when the Anthropic SDK throws
 *  - HaikuClientImpl.evaluate: throws HaikuParseError when response text is not valid JSON
 *  - HaikuClientImpl.evaluate: throws HaikuParseError when JSON is missing the confidence field
 *  - FakeHaikuClient: records calls, returns defaults, supports configure/configureError/reset
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';
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
// Helpers — build a mock Anthropic SDK response
// ---------------------------------------------------------------------------

/**
 * Build a minimal mock Anthropic messages response carrying the given text.
 */
function mockAnthropicResponse(text: string): object {
  return {
    id: 'msg_test',
    type: 'message',
    role: 'assistant',
    content: [{ type: 'text', text }],
    model: 'claude-haiku-4-5',
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: {
      input_tokens: 100,
      output_tokens: 50,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
  };
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
  it('returns { confidence, rationale } from a valid Haiku response', async () => {
    const validResponse = JSON.stringify({
      confidence: 0.85,
      rationale: 'Same name and cohort, different email domains.',
    });

    // Inject a mock Anthropic instance directly to avoid hitting the real SDK
    const mockCreate = vi.fn().mockResolvedValue(mockAnthropicResponse(validResponse));
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

    const result = await client.evaluate(userA, userB);
    expect(result.confidence).toBe(0.85);
    expect(result.rationale).toBe('Same name and cohort, different email domains.');
    expect(mockCreate).toHaveBeenCalledOnce();
  });

  it('clamps confidence > 1.0 to 1.0', async () => {
    const overflowResponse = JSON.stringify({ confidence: 1.5, rationale: 'Overflow test.' });
    const mockCreate = vi.fn().mockResolvedValue(mockAnthropicResponse(overflowResponse));
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

    const result = await client.evaluate(userA, userB);
    expect(result.confidence).toBe(1.0);
  });

  it('clamps confidence < 0.0 to 0.0', async () => {
    const underflowResponse = JSON.stringify({ confidence: -0.3, rationale: 'Underflow test.' });
    const mockCreate = vi.fn().mockResolvedValue(mockAnthropicResponse(underflowResponse));
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

    const result = await client.evaluate(userA, userB);
    expect(result.confidence).toBe(0.0);
  });

  it('includes both users fields in the messages.create call', async () => {
    const validResponse = JSON.stringify({ confidence: 0.7, rationale: 'Similar.' });
    const mockCreate = vi.fn().mockResolvedValue(mockAnthropicResponse(validResponse));
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

    await client.evaluate(userA, userB);

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-haiku-4-5');
    expect(callArgs.max_tokens).toBe(256);
    // The user message should contain both users' names
    const userMessage = callArgs.messages[0].content as string;
    expect(userMessage).toContain('Alice Smith');
    expect(userMessage).toContain('alice@example.com');
    expect(userMessage).toContain('alice.smith@students.jointheleague.org');
    // pike13_id and cohort_name should be included
    expect(userMessage).toContain('p13-001');
    expect(userMessage).toContain('Spring 2024');
  });
});

// ---------------------------------------------------------------------------
// HaikuClientImpl — HaikuApiError path
// ---------------------------------------------------------------------------

describe('HaikuClientImpl.evaluate — HaikuApiError', () => {
  it('throws HaikuApiError when the Anthropic SDK throws', async () => {
    const sdkError = new Error('Network error');
    const mockCreate = vi.fn().mockRejectedValue(sdkError);
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

    await expect(client.evaluate(userA, userB)).rejects.toThrow(HaikuApiError);
    await expect(client.evaluate(userA, userB)).rejects.not.toThrow(HaikuParseError);
  });

  it('wraps the original SDK error as cause', async () => {
    const sdkError = new Error('Rate limited');
    const mockCreate = vi.fn().mockRejectedValue(sdkError);
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

    try {
      await client.evaluate(userA, userB);
      expect.fail('Expected HaikuApiError to be thrown');
    } catch (err) {
      expect(err).toBeInstanceOf(HaikuApiError);
      expect((err as HaikuApiError).cause).toBe(sdkError);
    }
  });
});

// ---------------------------------------------------------------------------
// HaikuClientImpl — HaikuParseError path
// ---------------------------------------------------------------------------

describe('HaikuClientImpl.evaluate — HaikuParseError', () => {
  it('throws HaikuParseError when the response is not valid JSON', async () => {
    const mockCreate = vi
      .fn()
      .mockResolvedValue(mockAnthropicResponse('This is not JSON at all.'));
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

    await expect(client.evaluate(userA, userB)).rejects.toThrow(HaikuParseError);
  });

  it('stores the raw text on HaikuParseError for diagnostics', async () => {
    const rawText = 'definitely not json { broken';
    const mockCreate = vi.fn().mockResolvedValue(mockAnthropicResponse(rawText));
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

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
    const mockCreate = vi.fn().mockResolvedValue(mockAnthropicResponse(noConfidence));
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

    await expect(client.evaluate(userA, userB)).rejects.toThrow(HaikuParseError);
    await expect(client.evaluate(userA, userB)).rejects.not.toThrow(HaikuApiError);
  });

  it('throws HaikuParseError when JSON is missing the rationale field', async () => {
    const noRationale = JSON.stringify({ confidence: 0.8 });
    const mockCreate = vi.fn().mockResolvedValue(mockAnthropicResponse(noRationale));
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

    await expect(client.evaluate(userA, userB)).rejects.toThrow(HaikuParseError);
  });

  it('throws HaikuParseError when the response has no text block', async () => {
    const emptyContentResponse = {
      id: 'msg_test',
      type: 'message',
      role: 'assistant',
      content: [],
      model: 'claude-haiku-4-5',
      stop_reason: 'end_turn',
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 0 },
    };
    const mockCreate = vi.fn().mockResolvedValue(emptyContentResponse);
    const client = new HaikuClientImpl('test-key');
    (client as any).anthropic = { messages: { create: mockCreate } };

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
