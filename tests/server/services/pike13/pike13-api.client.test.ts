/**
 * Unit tests for Pike13ApiClientImpl and FakePike13ApiClient (Sprint 006 T001).
 *
 * Covers:
 *  - Typed error classes: correct name, message, and properties
 *  - Write-enable flag absent → Pike13WriteDisabledError for updateCustomField
 *  - Write-enable flag set to non-"1" value → Pike13WriteDisabledError
 *  - Write-enable flag present → updateCustomField proceeds past the gate
 *  - listPeople and getPerson are read-only → do not require PIKE13_WRITE_ENABLED
 *  - Missing PIKE13_ACCESS_TOKEN → Pike13ApiError with clear message
 *  - HTTP 404 → Pike13PersonNotFoundError (for getPerson and updateCustomField)
 *  - HTTP other non-2xx → Pike13ApiError
 *  - Network error → Pike13ApiError
 *  - Happy-path: listPeople returns Pike13PeoplePage, getPerson returns Pike13Person
 *  - FakePike13ApiClient: records calls, returns defaults, supports configure/configureError/reset
 *  - resolvePike13ApiUrl: env var precedence and default
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  Pike13ApiClientImpl,
  Pike13WriteDisabledError,
  Pike13ApiError,
  Pike13PersonNotFoundError,
  resolvePike13ApiUrl,
  DEFAULT_PIKE13_API_URL,
} from '../../../../server/src/services/pike13/pike13-api.client.js';
import { FakePike13ApiClient } from '../../helpers/fake-pike13-api.client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FAKE_TOKEN = 'fake-pike13-access-token';
const FAKE_API_URL = 'https://fake-pike13.example.com/api/v2/desk';

function makeClient(): Pike13ApiClientImpl {
  return new Pike13ApiClientImpl(FAKE_TOKEN, FAKE_API_URL);
}

// ---------------------------------------------------------------------------
// Typed error classes — unit tests
// ---------------------------------------------------------------------------

describe('Pike13WriteDisabledError', () => {
  it('has the correct name', () => {
    const err = new Pike13WriteDisabledError();
    expect(err.name).toBe('Pike13WriteDisabledError');
  });

  it('is an instance of Error', () => {
    expect(new Pike13WriteDisabledError()).toBeInstanceOf(Error);
  });

  it('includes PIKE13_WRITE_ENABLED in the message', () => {
    const err = new Pike13WriteDisabledError();
    expect(err.message).toContain('PIKE13_WRITE_ENABLED=1');
  });
});

describe('Pike13ApiError', () => {
  it('stores method, statusCode, and cause', () => {
    const cause = new Error('root');
    const err = new Pike13ApiError('API failed', 'listPeople', 500, cause);
    expect(err.name).toBe('Pike13ApiError');
    expect(err.method).toBe('listPeople');
    expect(err.statusCode).toBe(500);
    expect(err.cause).toBe(cause);
  });

  it('works without optional fields', () => {
    const err = new Pike13ApiError('oops', 'getPerson');
    expect(err.statusCode).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });

  it('is an instance of Error', () => {
    expect(new Pike13ApiError('x', 'y')).toBeInstanceOf(Error);
  });
});

describe('Pike13PersonNotFoundError', () => {
  it('stores personId and cause', () => {
    const cause = new Error('root');
    const err = new Pike13PersonNotFoundError(42, 'getPerson', cause);
    expect(err.name).toBe('Pike13PersonNotFoundError');
    expect(err.personId).toBe(42);
    expect(err.message).toContain('42');
    expect(err.cause).toBe(cause);
  });

  it('includes the method name in the message', () => {
    const err = new Pike13PersonNotFoundError(7, 'updateCustomField');
    expect(err.message).toContain('updateCustomField');
  });

  it('is an instance of Error', () => {
    expect(new Pike13PersonNotFoundError(1, 'getPerson')).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// Write-enable flag tests
// ---------------------------------------------------------------------------

describe('Pike13ApiClientImpl write-enable flag — updateCustomField', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    originalEnv.PIKE13_WRITE_ENABLED = process.env.PIKE13_WRITE_ENABLED;
  });

  afterEach(() => {
    if (originalEnv.PIKE13_WRITE_ENABLED === undefined) {
      delete process.env.PIKE13_WRITE_ENABLED;
    } else {
      process.env.PIKE13_WRITE_ENABLED = originalEnv.PIKE13_WRITE_ENABLED;
    }
    vi.unstubAllGlobals();
  });

  it('throws Pike13WriteDisabledError when PIKE13_WRITE_ENABLED is absent', async () => {
    delete process.env.PIKE13_WRITE_ENABLED;
    const client = makeClient();
    await expect(client.updateCustomField(1, 'field-1', 'value-1')).rejects.toBeInstanceOf(
      Pike13WriteDisabledError,
    );
  });

  it('throws Pike13WriteDisabledError when PIKE13_WRITE_ENABLED is "0"', async () => {
    process.env.PIKE13_WRITE_ENABLED = '0';
    const client = makeClient();
    await expect(client.updateCustomField(1, 'field-1', 'value-1')).rejects.toBeInstanceOf(
      Pike13WriteDisabledError,
    );
  });

  it('throws Pike13WriteDisabledError when PIKE13_WRITE_ENABLED is "true" (not exactly "1")', async () => {
    process.env.PIKE13_WRITE_ENABLED = 'true';
    const client = makeClient();
    await expect(client.updateCustomField(1, 'field-1', 'value-1')).rejects.toBeInstanceOf(
      Pike13WriteDisabledError,
    );
  });

  it('passes the write gate when PIKE13_WRITE_ENABLED is "1" (proceeds to HTTP call)', async () => {
    process.env.PIKE13_WRITE_ENABLED = '1';
    // Stub fetch so we don't hit the network, but the flag gate is passed.
    vi.stubGlobal(
      'fetch',
      vi.fn().mockRejectedValue(new TypeError('fetch is stubbed — no network')),
    );
    const client = makeClient();

    let caught: unknown;
    try {
      await client.updateCustomField(1, 'field-1', 'value-1');
    } catch (err) {
      caught = err;
    }

    // Must fail with a network/API error, NOT a write-disabled error.
    expect(caught).toBeDefined();
    expect(caught).not.toBeInstanceOf(Pike13WriteDisabledError);
    expect(caught).toBeInstanceOf(Pike13ApiError);
  });
});

// ---------------------------------------------------------------------------
// Missing credentials tests
// ---------------------------------------------------------------------------

describe('Pike13ApiClientImpl — missing PIKE13_ACCESS_TOKEN', () => {
  it('listPeople throws Pike13ApiError with clear message when access token is empty', async () => {
    const client = new Pike13ApiClientImpl('', FAKE_API_URL);
    let caught: unknown;
    try {
      await client.listPeople();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Pike13ApiError);
    expect((caught as Pike13ApiError).message).toContain('PIKE13_ACCESS_TOKEN');
  });

  it('getPerson throws Pike13ApiError with clear message when access token is empty', async () => {
    const client = new Pike13ApiClientImpl('', FAKE_API_URL);
    await expect(client.getPerson(42)).rejects.toBeInstanceOf(Pike13ApiError);
  });
});

// ---------------------------------------------------------------------------
// HTTP error mapping tests
// ---------------------------------------------------------------------------

describe('Pike13ApiClientImpl HTTP error mapping', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    originalEnv.PIKE13_WRITE_ENABLED = process.env.PIKE13_WRITE_ENABLED;
  });

  afterEach(() => {
    if (originalEnv.PIKE13_WRITE_ENABLED === undefined) {
      delete process.env.PIKE13_WRITE_ENABLED;
    } else {
      process.env.PIKE13_WRITE_ENABLED = originalEnv.PIKE13_WRITE_ENABLED;
    }
    vi.unstubAllGlobals();
  });

  it('getPerson: 404 response → Pike13PersonNotFoundError', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      }),
    );
    const client = makeClient();
    await expect(client.getPerson(99)).rejects.toBeInstanceOf(Pike13PersonNotFoundError);
  });

  it('getPerson: 404 error contains the correct personId', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => null,
      }),
    );
    const client = makeClient();
    let caught: unknown;
    try {
      await client.getPerson(123);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Pike13PersonNotFoundError);
    expect((caught as Pike13PersonNotFoundError).personId).toBe(123);
  });

  it('getPerson: 500 response → Pike13ApiError with statusCode 500', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'Internal server error' }),
      }),
    );
    const client = makeClient();
    let caught: unknown;
    try {
      await client.getPerson(1);
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Pike13ApiError);
    expect((caught as Pike13ApiError).statusCode).toBe(500);
  });

  it('listPeople: 401 response → Pike13ApiError with statusCode 401', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({ error: 'Unauthorized' }),
      }),
    );
    const client = makeClient();
    await expect(client.listPeople()).rejects.toBeInstanceOf(Pike13ApiError);
    let caught: unknown;
    try {
      await client.listPeople();
    } catch (err) {
      caught = err;
    }
    expect((caught as Pike13ApiError).statusCode).toBe(401);
  });

  it('updateCustomField: 404 → Pike13PersonNotFoundError', async () => {
    process.env.PIKE13_WRITE_ENABLED = '1';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      }),
    );
    const client = makeClient();
    await expect(client.updateCustomField(55, 'f1', 'v1')).rejects.toBeInstanceOf(
      Pike13PersonNotFoundError,
    );
  });

  it('network error → Pike13ApiError wrapping the original error', async () => {
    const networkErr = new TypeError('Failed to fetch');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(networkErr));
    const client = makeClient();
    let caught: unknown;
    try {
      await client.listPeople();
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(Pike13ApiError);
    expect((caught as Pike13ApiError).cause).toBe(networkErr);
  });
});

// ---------------------------------------------------------------------------
// Happy-path tests
// ---------------------------------------------------------------------------

describe('Pike13ApiClientImpl happy-path call signatures', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    originalEnv.PIKE13_WRITE_ENABLED = process.env.PIKE13_WRITE_ENABLED;
  });

  afterEach(() => {
    if (originalEnv.PIKE13_WRITE_ENABLED === undefined) {
      delete process.env.PIKE13_WRITE_ENABLED;
    } else {
      process.env.PIKE13_WRITE_ENABLED = originalEnv.PIKE13_WRITE_ENABLED;
    }
    vi.unstubAllGlobals();
  });

  it('listPeople: returns Pike13PeoplePage with people and nextCursor', async () => {
    const fakePeople = [
      { id: 1, first_name: 'Alice', last_name: 'Smith', email: 'alice@example.com' },
    ];
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ people: fakePeople, next_cursor: 'cursor-abc' }),
      }),
    );
    const client = makeClient();
    const page = await client.listPeople();
    expect(page.people).toEqual(fakePeople);
    expect(page.nextCursor).toBe('cursor-abc');
  });

  it('listPeople: returns nextCursor null when last page', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ people: [], next_cursor: null }),
      }),
    );
    const client = makeClient();
    const page = await client.listPeople();
    expect(page.nextCursor).toBeNull();
  });

  it('listPeople: passes cursor as query parameter on subsequent pages', async () => {
    let capturedUrl = '';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation((url: string) => {
        capturedUrl = url;
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ people: [], next_cursor: null }),
        });
      }),
    );
    const client = makeClient();
    await client.listPeople('cursor-xyz');
    expect(capturedUrl).toContain('cursor=cursor-xyz');
  });

  it('getPerson: returns the person object (direct response shape)', async () => {
    const fakePerson = { id: 7, first_name: 'Bob', last_name: 'Jones', email: 'bob@example.com' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => fakePerson,
      }),
    );
    const client = makeClient();
    const person = await client.getPerson(7);
    expect(person.id).toBe(7);
    expect(person.email).toBe('bob@example.com');
  });

  it('getPerson: unwraps { person: { ... } } response shape', async () => {
    const fakePerson = { id: 8, first_name: 'Carol', last_name: 'Lee', email: 'carol@example.com' };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ person: fakePerson }),
      }),
    );
    const client = makeClient();
    const person = await client.getPerson(8);
    expect(person.id).toBe(8);
    expect(person.email).toBe('carol@example.com');
  });

  it('updateCustomField: resolves void on success (204)', async () => {
    process.env.PIKE13_WRITE_ENABLED = '1';
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      }),
    );
    const client = makeClient();
    await expect(client.updateCustomField(10, 'field-id', 'new-value')).resolves.toBeUndefined();
  });

  it('listPeople does NOT require PIKE13_WRITE_ENABLED', async () => {
    delete process.env.PIKE13_WRITE_ENABLED;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ people: [], next_cursor: null }),
      }),
    );
    const client = makeClient();
    await expect(client.listPeople()).resolves.toBeDefined();
  });

  it('getPerson does NOT require PIKE13_WRITE_ENABLED', async () => {
    delete process.env.PIKE13_WRITE_ENABLED;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ id: 1, first_name: 'X', last_name: 'Y', email: 'x@y.com' }),
      }),
    );
    const client = makeClient();
    await expect(client.getPerson(1)).resolves.toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// resolvePike13ApiUrl — env var precedence
// ---------------------------------------------------------------------------

describe('resolvePike13ApiUrl', () => {
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    savedEnv.PIKE13_API_URL = process.env.PIKE13_API_URL;
    savedEnv.PIKE13_API_BASE = process.env.PIKE13_API_BASE;
  });

  afterEach(() => {
    for (const key of ['PIKE13_API_URL', 'PIKE13_API_BASE']) {
      if (savedEnv[key] === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = savedEnv[key];
      }
    }
  });

  it('returns DEFAULT_PIKE13_API_URL when neither var is set', () => {
    delete process.env.PIKE13_API_URL;
    delete process.env.PIKE13_API_BASE;
    expect(resolvePike13ApiUrl()).toBe(DEFAULT_PIKE13_API_URL);
  });

  it('returns PIKE13_API_URL when only it is set', () => {
    process.env.PIKE13_API_URL = 'https://myschool.pike13.com/api/v2/desk';
    delete process.env.PIKE13_API_BASE;
    expect(resolvePike13ApiUrl()).toBe('https://myschool.pike13.com/api/v2/desk');
  });

  it('returns PIKE13_API_BASE when only it is set', () => {
    delete process.env.PIKE13_API_URL;
    process.env.PIKE13_API_BASE = 'https://base.pike13.com/api/v2/desk';
    expect(resolvePike13ApiUrl()).toBe('https://base.pike13.com/api/v2/desk');
  });

  it('PIKE13_API_URL wins when both are set', () => {
    process.env.PIKE13_API_URL = 'https://url.pike13.com/api/v2/desk';
    process.env.PIKE13_API_BASE = 'https://base.pike13.com/api/v2/desk';
    expect(resolvePike13ApiUrl()).toBe('https://url.pike13.com/api/v2/desk');
  });

  it('DEFAULT_PIKE13_API_URL constant is the expected Pike13 API base URL', () => {
    expect(DEFAULT_PIKE13_API_URL).toBe('https://pike13.com/api/v2/desk');
  });
});

// ---------------------------------------------------------------------------
// FakePike13ApiClient — unit tests
// ---------------------------------------------------------------------------

describe('FakePike13ApiClient', () => {
  let fake: FakePike13ApiClient;

  beforeEach(() => {
    fake = new FakePike13ApiClient();
  });

  describe('default behaviour', () => {
    it('listPeople records cursor and returns empty page by default', async () => {
      const result = await fake.listPeople();
      expect(result.people).toEqual([]);
      expect(result.nextCursor).toBeNull();
      expect(fake.calls.listPeople).toEqual([undefined]);
    });

    it('listPeople records the cursor when provided', async () => {
      await fake.listPeople('cursor-abc');
      expect(fake.calls.listPeople).toEqual(['cursor-abc']);
    });

    it('getPerson records personId and returns a default person', async () => {
      const result = await fake.getPerson(42);
      expect(result.id).toBe(42);
      expect(result.email).toContain('42');
      expect(fake.calls.getPerson).toEqual([42]);
    });

    it('updateCustomField records call and resolves void', async () => {
      await fake.updateCustomField(7, 'field-1', 'value-1');
      expect(fake.calls.updateCustomField).toEqual([
        { personId: 7, fieldId: 'field-1', value: 'value-1' },
      ]);
    });
  });

  describe('configure()', () => {
    it('overrides listPeople return value', async () => {
      const fakePeople = [
        { id: 1, first_name: 'Alice', last_name: 'S', email: 'alice@example.com' },
      ];
      fake.configure('listPeople', { people: fakePeople, nextCursor: 'cursor-next' });
      const result = await fake.listPeople();
      expect(result.people).toEqual(fakePeople);
      expect(result.nextCursor).toBe('cursor-next');
    });

    it('overrides getPerson return value', async () => {
      const fakePerson = { id: 99, first_name: 'Bob', last_name: 'T', email: 'bob@example.com' };
      fake.configure('getPerson', fakePerson);
      const result = await fake.getPerson(99);
      expect(result).toEqual(fakePerson);
    });
  });

  describe('configureError()', () => {
    it('makes listPeople throw the configured error', async () => {
      const err = new Pike13ApiError('list failed', 'listPeople', 500);
      fake.configureError('listPeople', err);
      await expect(fake.listPeople()).rejects.toThrow(err);
      // Call is still recorded even when it throws
      expect(fake.calls.listPeople).toHaveLength(1);
    });

    it('makes getPerson throw Pike13PersonNotFoundError', async () => {
      const err = new Pike13PersonNotFoundError(42, 'getPerson');
      fake.configureError('getPerson', err);
      await expect(fake.getPerson(42)).rejects.toBeInstanceOf(Pike13PersonNotFoundError);
      expect(fake.calls.getPerson).toEqual([42]);
    });

    it('makes updateCustomField throw Pike13WriteDisabledError', async () => {
      const err = new Pike13WriteDisabledError();
      fake.configureError('updateCustomField', err);
      await expect(fake.updateCustomField(1, 'f', 'v')).rejects.toBeInstanceOf(
        Pike13WriteDisabledError,
      );
      expect(fake.calls.updateCustomField).toHaveLength(1);
    });
  });

  describe('reset()', () => {
    it('clears recorded calls and configured overrides', async () => {
      await fake.listPeople('cursor-1');
      await fake.getPerson(5);
      fake.configure('listPeople', {
        people: [{ id: 1, first_name: 'X', last_name: 'Y', email: 'x@y.com' }],
        nextCursor: null,
      });
      fake.configureError('getPerson', new Pike13ApiError('boom', 'getPerson', 500));

      fake.reset();

      expect(fake.calls.listPeople).toHaveLength(0);
      expect(fake.calls.getPerson).toHaveLength(0);
      expect(fake.calls.updateCustomField).toHaveLength(0);

      // After reset, defaults apply again
      const page = await fake.listPeople();
      expect(page.people).toEqual([]);

      // After reset, error override is gone
      const person = await fake.getPerson(99);
      expect(person.id).toBe(99);
    });
  });
});
