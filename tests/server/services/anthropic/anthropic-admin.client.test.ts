/**
 * Unit tests for AnthropicAdminClientImpl (Sprint 010 T002).
 *
 * Covers:
 *  - Error class shape: AnthropicAdminApiError, AnthropicAdminNotFoundError,
 *    AnthropicAdminWriteDisabledError
 *  - Write-enable kill switch: each mutating method throws
 *    AnthropicAdminWriteDisabledError when CLAUDE_TEAM_WRITE_ENABLED !== "1"
 *  - fetch mock 200 success paths for read operations
 *  - fetch mock error-code mapping:
 *      401 → AnthropicAdminApiError (statusCode 401)
 *      403 → AnthropicAdminApiError (statusCode 403)
 *      404 → AnthropicAdminNotFoundError
 *      429 → AnthropicAdminApiError (statusCode 429)
 *  - AnthropicAdminNotFoundError is instanceof AnthropicAdminApiError
 *  - resolveAnthropicAdminApiKey: prefers ANTHROPIC_ADMIN_API_KEY, falls back
 *    to CLAUDE_TEAM_API_KEY, returns '' if neither is set
 *
 * All tests use mocked fetch — no real network calls are made.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  AnthropicAdminClientImpl,
  AnthropicAdminApiError,
  AnthropicAdminNotFoundError,
  AnthropicAdminWriteDisabledError,
  resolveAnthropicAdminApiKey,
} from '../../../../server/src/services/anthropic/anthropic-admin.client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(): AnthropicAdminClientImpl {
  return new AnthropicAdminClientImpl('test-api-key');
}

/** Build a minimal mock Response object. */
function mockResponse(status: number, body: unknown = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as unknown as Response;
}

/** Stub global fetch with the given resolved value. */
function stubFetch(response: Response): void {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));
}

/** Stub global fetch to reject (network error). */
function stubFetchNetworkError(): void {
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('network failed')));
}

// ---------------------------------------------------------------------------
// Error class unit tests
// ---------------------------------------------------------------------------

describe('AnthropicAdminApiError', () => {
  it('has the correct name', () => {
    const err = new AnthropicAdminApiError('bad', 'listOrgUsers', 500);
    expect(err.name).toBe('AnthropicAdminApiError');
  });

  it('stores method, statusCode, and cause', () => {
    const cause = new Error('root');
    const err = new AnthropicAdminApiError('bad', 'getOrgUser', 503, cause);
    expect(err.method).toBe('getOrgUser');
    expect(err.statusCode).toBe(503);
    expect(err.cause).toBe(cause);
  });

  it('works without optional fields', () => {
    const err = new AnthropicAdminApiError('bad', 'listInvites');
    expect(err.statusCode).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });

  it('is an instance of Error', () => {
    expect(new AnthropicAdminApiError('x', 'y')).toBeInstanceOf(Error);
  });
});

describe('AnthropicAdminNotFoundError', () => {
  it('has the correct name', () => {
    const err = new AnthropicAdminNotFoundError('not found', 'getOrgUser');
    expect(err.name).toBe('AnthropicAdminNotFoundError');
  });

  it('has statusCode 404', () => {
    const err = new AnthropicAdminNotFoundError('not found', 'getOrgUser');
    expect(err.statusCode).toBe(404);
  });

  it('is instanceof AnthropicAdminApiError', () => {
    expect(new AnthropicAdminNotFoundError('x', 'y')).toBeInstanceOf(AnthropicAdminApiError);
  });

  it('is instanceof Error', () => {
    expect(new AnthropicAdminNotFoundError('x', 'y')).toBeInstanceOf(Error);
  });

  it('stores cause', () => {
    const cause = new Error('root');
    const err = new AnthropicAdminNotFoundError('not found', 'cancelInvite', cause);
    expect(err.cause).toBe(cause);
  });
});

describe('AnthropicAdminWriteDisabledError', () => {
  it('has the correct name', () => {
    const err = new AnthropicAdminWriteDisabledError();
    expect(err.name).toBe('AnthropicAdminWriteDisabledError');
  });

  it('message mentions CLAUDE_TEAM_WRITE_ENABLED', () => {
    const err = new AnthropicAdminWriteDisabledError();
    expect(err.message).toContain('CLAUDE_TEAM_WRITE_ENABLED=1');
  });

  it('is instanceof Error', () => {
    expect(new AnthropicAdminWriteDisabledError()).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// resolveAnthropicAdminApiKey
// ---------------------------------------------------------------------------

describe('resolveAnthropicAdminApiKey', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.ANTHROPIC_ADMIN_API_KEY = process.env.ANTHROPIC_ADMIN_API_KEY;
    saved.CLAUDE_TEAM_API_KEY = process.env.CLAUDE_TEAM_API_KEY;
  });

  afterEach(() => {
    if (saved.ANTHROPIC_ADMIN_API_KEY === undefined) {
      delete process.env.ANTHROPIC_ADMIN_API_KEY;
    } else {
      process.env.ANTHROPIC_ADMIN_API_KEY = saved.ANTHROPIC_ADMIN_API_KEY;
    }
    if (saved.CLAUDE_TEAM_API_KEY === undefined) {
      delete process.env.CLAUDE_TEAM_API_KEY;
    } else {
      process.env.CLAUDE_TEAM_API_KEY = saved.CLAUDE_TEAM_API_KEY;
    }
  });

  it('returns ANTHROPIC_ADMIN_API_KEY when set', () => {
    process.env.ANTHROPIC_ADMIN_API_KEY = 'primary-key';
    process.env.CLAUDE_TEAM_API_KEY = 'legacy-key';
    expect(resolveAnthropicAdminApiKey()).toBe('primary-key');
  });

  it('falls back to CLAUDE_TEAM_API_KEY when ANTHROPIC_ADMIN_API_KEY is absent', () => {
    delete process.env.ANTHROPIC_ADMIN_API_KEY;
    process.env.CLAUDE_TEAM_API_KEY = 'legacy-key';
    expect(resolveAnthropicAdminApiKey()).toBe('legacy-key');
  });

  it('returns empty string when neither var is set', () => {
    delete process.env.ANTHROPIC_ADMIN_API_KEY;
    delete process.env.CLAUDE_TEAM_API_KEY;
    expect(resolveAnthropicAdminApiKey()).toBe('');
  });
});

// ---------------------------------------------------------------------------
// Write-enable kill switch — all mutating methods
// ---------------------------------------------------------------------------

describe('AnthropicAdminClientImpl write-enable kill switch', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.CLAUDE_TEAM_WRITE_ENABLED = process.env.CLAUDE_TEAM_WRITE_ENABLED;
  });

  afterEach(() => {
    if (saved.CLAUDE_TEAM_WRITE_ENABLED === undefined) {
      delete process.env.CLAUDE_TEAM_WRITE_ENABLED;
    } else {
      process.env.CLAUDE_TEAM_WRITE_ENABLED = saved.CLAUDE_TEAM_WRITE_ENABLED;
    }
    vi.unstubAllGlobals();
  });

  describe('when CLAUDE_TEAM_WRITE_ENABLED is absent', () => {
    beforeEach(() => {
      delete process.env.CLAUDE_TEAM_WRITE_ENABLED;
    });

    it('inviteToOrg throws AnthropicAdminWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.inviteToOrg({ email: 'x@x.com' })).rejects.toThrow(
        AnthropicAdminWriteDisabledError,
      );
    });

    it('deleteOrgUser throws AnthropicAdminWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.deleteOrgUser('uid-1')).rejects.toThrow(AnthropicAdminWriteDisabledError);
    });

    it('cancelInvite throws AnthropicAdminWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.cancelInvite('inv-1')).rejects.toThrow(AnthropicAdminWriteDisabledError);
    });

    it('addUserToWorkspace throws AnthropicAdminWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.addUserToWorkspace('ws-1', 'uid-1')).rejects.toThrow(
        AnthropicAdminWriteDisabledError,
      );
    });

    it('removeUserFromWorkspace throws AnthropicAdminWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.removeUserFromWorkspace('ws-1', 'uid-1')).rejects.toThrow(
        AnthropicAdminWriteDisabledError,
      );
    });
  });

  describe('when CLAUDE_TEAM_WRITE_ENABLED is non-"1" value', () => {
    beforeEach(() => {
      process.env.CLAUDE_TEAM_WRITE_ENABLED = 'true';
    });

    it('inviteToOrg throws AnthropicAdminWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.inviteToOrg({ email: 'x@x.com' })).rejects.toThrow(
        AnthropicAdminWriteDisabledError,
      );
    });

    it('deleteOrgUser throws AnthropicAdminWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.deleteOrgUser('uid-1')).rejects.toThrow(AnthropicAdminWriteDisabledError);
    });
  });
});

// ---------------------------------------------------------------------------
// HTTP error-code mapping — 200, 401, 403, 404, 429
// ---------------------------------------------------------------------------

describe('AnthropicAdminClientImpl error mapping', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.CLAUDE_TEAM_WRITE_ENABLED = process.env.CLAUDE_TEAM_WRITE_ENABLED;
    process.env.CLAUDE_TEAM_WRITE_ENABLED = '1';
  });

  afterEach(() => {
    if (saved.CLAUDE_TEAM_WRITE_ENABLED === undefined) {
      delete process.env.CLAUDE_TEAM_WRITE_ENABLED;
    } else {
      process.env.CLAUDE_TEAM_WRITE_ENABLED = saved.CLAUDE_TEAM_WRITE_ENABLED;
    }
    vi.unstubAllGlobals();
  });

  // ---- 200 success ----

  it('listOrgUsers returns data and nextCursor on 200', async () => {
    const fakeUser = { id: 'u1', email: 'a@b.com', role: 'user' };
    stubFetch(mockResponse(200, { data: [fakeUser], has_more: false, last_id: 'u1' }));
    const client = makeClient();
    const result = await client.listOrgUsers();
    expect(result.data).toEqual([fakeUser]);
    expect(result.nextCursor).toBeUndefined();
  });

  it('listOrgUsers sets nextCursor when has_more=true', async () => {
    const fakeUser = { id: 'u1', email: 'a@b.com', role: 'user' };
    stubFetch(mockResponse(200, { data: [fakeUser], has_more: true, last_id: 'cursor-abc' }));
    const client = makeClient();
    const result = await client.listOrgUsers();
    expect(result.nextCursor).toBe('cursor-abc');
  });

  it('getOrgUser returns user on 200', async () => {
    const fakeUser = { id: 'u1', email: 'a@b.com', role: 'admin' };
    stubFetch(mockResponse(200, fakeUser));
    const client = makeClient();
    const user = await client.getOrgUser('u1');
    expect(user).toEqual(fakeUser);
  });

  it('listInvites returns data on 200', async () => {
    const fakeInvite = { id: 'i1', email: 'x@y.com', role: 'user', status: 'pending' };
    stubFetch(mockResponse(200, { data: [fakeInvite], has_more: false, last_id: 'i1' }));
    const client = makeClient();
    const result = await client.listInvites();
    expect(result.data).toEqual([fakeInvite]);
  });

  it('listWorkspaces returns array on 200', async () => {
    const fakeWs = { id: 'ws1', name: 'Main' };
    stubFetch(mockResponse(200, { data: [fakeWs] }));
    const client = makeClient();
    const workspaces = await client.listWorkspaces();
    expect(workspaces).toEqual([fakeWs]);
  });

  it('inviteToOrg returns invite on 200', async () => {
    const fakeInvite = { id: 'i2', email: 'new@org.com', role: 'user', status: 'pending' };
    stubFetch(mockResponse(200, fakeInvite));
    const client = makeClient();
    const invite = await client.inviteToOrg({ email: 'new@org.com' });
    expect(invite).toEqual(fakeInvite);
  });

  it('deleteOrgUser resolves on 204', async () => {
    stubFetch(mockResponse(204));
    const client = makeClient();
    await expect(client.deleteOrgUser('u1')).resolves.not.toThrow();
  });

  it('cancelInvite resolves on 204', async () => {
    stubFetch(mockResponse(204));
    const client = makeClient();
    await expect(client.cancelInvite('inv-1')).resolves.not.toThrow();
  });

  it('addUserToWorkspace resolves on 200', async () => {
    stubFetch(mockResponse(200, {}));
    const client = makeClient();
    await expect(client.addUserToWorkspace('ws-1', 'u1')).resolves.not.toThrow();
  });

  it('removeUserFromWorkspace resolves on 204', async () => {
    stubFetch(mockResponse(204));
    const client = makeClient();
    await expect(client.removeUserFromWorkspace('ws-1', 'u1')).resolves.not.toThrow();
  });

  // ---- 401 → AnthropicAdminApiError ----

  it('listOrgUsers throws AnthropicAdminApiError with statusCode 401', async () => {
    stubFetch(mockResponse(401, { error: { type: 'authentication_error', message: 'Unauthorized' } }));
    const client = makeClient();
    const err = await client.listOrgUsers().catch((e) => e);
    expect(err).toBeInstanceOf(AnthropicAdminApiError);
    expect(err.statusCode).toBe(401);
    expect(err.name).toBe('AnthropicAdminApiError');
  });

  it('getOrgUser throws AnthropicAdminApiError with statusCode 401', async () => {
    stubFetch(mockResponse(401, {}));
    const client = makeClient();
    const err = await client.getOrgUser('uid-1').catch((e) => e);
    expect(err).toBeInstanceOf(AnthropicAdminApiError);
    expect(err.statusCode).toBe(401);
  });

  // ---- 403 → AnthropicAdminApiError ----

  it('listOrgUsers throws AnthropicAdminApiError with statusCode 403', async () => {
    stubFetch(mockResponse(403, { error: { type: 'permission_error', message: 'Forbidden' } }));
    const client = makeClient();
    const err = await client.listOrgUsers().catch((e) => e);
    expect(err).toBeInstanceOf(AnthropicAdminApiError);
    expect(err.statusCode).toBe(403);
  });

  it('inviteToOrg throws AnthropicAdminApiError with statusCode 403', async () => {
    stubFetch(mockResponse(403, {}));
    const client = makeClient();
    const err = await client.inviteToOrg({ email: 'x@x.com' }).catch((e) => e);
    expect(err).toBeInstanceOf(AnthropicAdminApiError);
    expect(err.statusCode).toBe(403);
  });

  // ---- 404 → AnthropicAdminNotFoundError ----

  it('getOrgUser throws AnthropicAdminNotFoundError on 404', async () => {
    stubFetch(mockResponse(404, { error: { type: 'not_found_error', message: 'User not found' } }));
    const client = makeClient();
    const err = await client.getOrgUser('nonexistent').catch((e) => e);
    expect(err).toBeInstanceOf(AnthropicAdminNotFoundError);
    expect(err).toBeInstanceOf(AnthropicAdminApiError);
    expect(err.statusCode).toBe(404);
    expect(err.name).toBe('AnthropicAdminNotFoundError');
  });

  it('deleteOrgUser throws AnthropicAdminNotFoundError on 404', async () => {
    stubFetch(mockResponse(404, {}));
    const client = makeClient();
    const err = await client.deleteOrgUser('uid-gone').catch((e) => e);
    expect(err).toBeInstanceOf(AnthropicAdminNotFoundError);
    expect(err.statusCode).toBe(404);
  });

  it('cancelInvite throws AnthropicAdminNotFoundError on 404', async () => {
    stubFetch(mockResponse(404, {}));
    const client = makeClient();
    const err = await client.cancelInvite('inv-gone').catch((e) => e);
    expect(err).toBeInstanceOf(AnthropicAdminNotFoundError);
  });

  // ---- 429 → AnthropicAdminApiError ----

  it('listOrgUsers throws AnthropicAdminApiError with statusCode 429', async () => {
    stubFetch(mockResponse(429, { error: { type: 'rate_limit_error', message: 'Rate limited' } }));
    const client = makeClient();
    const err = await client.listOrgUsers().catch((e) => e);
    expect(err).toBeInstanceOf(AnthropicAdminApiError);
    expect(err.statusCode).toBe(429);
    expect(err.name).toBe('AnthropicAdminApiError');
  });

  it('inviteToOrg throws AnthropicAdminApiError with statusCode 429', async () => {
    stubFetch(mockResponse(429, {}));
    const client = makeClient();
    const err = await client.inviteToOrg({ email: 'x@x.com' }).catch((e) => e);
    expect(err).toBeInstanceOf(AnthropicAdminApiError);
    expect(err.statusCode).toBe(429);
  });

  // ---- network error ----

  it('listOrgUsers throws AnthropicAdminApiError on network failure', async () => {
    stubFetchNetworkError();
    const client = makeClient();
    const err = await client.listOrgUsers().catch((e) => e);
    expect(err).toBeInstanceOf(AnthropicAdminApiError);
    expect(err.statusCode).toBeUndefined();
    expect(err.message).toContain('Network error');
  });
});

// ---------------------------------------------------------------------------
// Auth header shape — x-api-key (not Authorization: Bearer)
// ---------------------------------------------------------------------------

describe('AnthropicAdminClientImpl auth headers', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('sends x-api-key header, not Authorization: Bearer', async () => {
    const fetchSpy = vi.fn().mockResolvedValue(mockResponse(200, { data: [], has_more: false }));
    vi.stubGlobal('fetch', fetchSpy);

    const client = new AnthropicAdminClientImpl('my-secret-key');
    await client.listOrgUsers();

    expect(fetchSpy).toHaveBeenCalledOnce();
    const [, options] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const headers = options.headers as Record<string, string>;

    expect(headers['x-api-key']).toBe('my-secret-key');
    expect(headers['anthropic-version']).toBe('2023-06-01');
    expect(headers['Authorization']).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Write-disabled path for mutating methods (positive: flag set, fetch returns 200/204)
// ---------------------------------------------------------------------------

describe('AnthropicAdminClientImpl write operations succeed with flag set', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    saved.CLAUDE_TEAM_WRITE_ENABLED = process.env.CLAUDE_TEAM_WRITE_ENABLED;
    process.env.CLAUDE_TEAM_WRITE_ENABLED = '1';
  });

  afterEach(() => {
    if (saved.CLAUDE_TEAM_WRITE_ENABLED === undefined) {
      delete process.env.CLAUDE_TEAM_WRITE_ENABLED;
    } else {
      process.env.CLAUDE_TEAM_WRITE_ENABLED = saved.CLAUDE_TEAM_WRITE_ENABLED;
    }
    vi.unstubAllGlobals();
  });

  it('does not throw AnthropicAdminWriteDisabledError when flag=1 (deleteOrgUser)', async () => {
    stubFetch(mockResponse(204));
    const client = makeClient();
    await expect(client.deleteOrgUser('uid-1')).resolves.not.toThrow();
  });

  it('does not throw AnthropicAdminWriteDisabledError when flag=1 (cancelInvite)', async () => {
    stubFetch(mockResponse(204));
    const client = makeClient();
    await expect(client.cancelInvite('inv-1')).resolves.not.toThrow();
  });
});
