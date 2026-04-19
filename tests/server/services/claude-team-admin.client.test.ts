/**
 * Unit tests for ClaudeTeamAdminClientImpl and FakeClaudeTeamAdminClient
 * (Sprint 005, T002).
 *
 * Covers:
 *  - Write-enable flag absent → ClaudeTeamWriteDisabledError for each mutating method
 *  - Write-enable flag present → mutating methods proceed (network errors expected
 *    since no real API is available, proving the flag gate was passed)
 *  - listMembers is read-only → does not require CLAUDE_TEAM_WRITE_ENABLED
 *  - Typed error classes: correct name, message, and properties
 *  - FakeClaudeTeamAdminClient: records calls, returns defaults, supports configure/configureError/reset
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  ClaudeTeamAdminClientImpl,
  ClaudeTeamWriteDisabledError,
  ClaudeTeamApiError,
  ClaudeTeamMemberNotFoundError,
} from '../../../server/src/services/claude-team/claude-team-admin.client.js';
import { FakeClaudeTeamAdminClient } from '../helpers/fake-claude-team-admin.client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeClient(): ClaudeTeamAdminClientImpl {
  return new ClaudeTeamAdminClientImpl('test-api-key', 'test-product-id');
}

// ---------------------------------------------------------------------------
// ClaudeTeamWriteDisabledError — unit tests
// ---------------------------------------------------------------------------

describe('ClaudeTeamWriteDisabledError', () => {
  it('has the correct name and message', () => {
    const err = new ClaudeTeamWriteDisabledError();
    expect(err.name).toBe('ClaudeTeamWriteDisabledError');
    expect(err.message).toContain('CLAUDE_TEAM_WRITE_ENABLED=1');
  });

  it('is an instance of Error', () => {
    expect(new ClaudeTeamWriteDisabledError()).toBeInstanceOf(Error);
  });
});

// ---------------------------------------------------------------------------
// ClaudeTeamApiError — unit tests
// ---------------------------------------------------------------------------

describe('ClaudeTeamApiError', () => {
  it('stores method, statusCode, and cause', () => {
    const cause = new Error('root');
    const err = new ClaudeTeamApiError('API blew up', 'inviteMember', 500, cause);
    expect(err.name).toBe('ClaudeTeamApiError');
    expect(err.method).toBe('inviteMember');
    expect(err.statusCode).toBe(500);
    expect(err.cause).toBe(cause);
  });

  it('works without optional fields', () => {
    const err = new ClaudeTeamApiError('oops', 'listMembers');
    expect(err.statusCode).toBeUndefined();
    expect(err.cause).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// ClaudeTeamMemberNotFoundError — unit tests
// ---------------------------------------------------------------------------

describe('ClaudeTeamMemberNotFoundError', () => {
  it('stores memberId and cause', () => {
    const cause = new Error('root');
    const err = new ClaudeTeamMemberNotFoundError('mem-123', 'removeMember', cause);
    expect(err.name).toBe('ClaudeTeamMemberNotFoundError');
    expect(err.memberId).toBe('mem-123');
    expect(err.message).toContain('mem-123');
    expect(err.cause).toBe(cause);
  });
});

// ---------------------------------------------------------------------------
// ClaudeTeamAdminClientImpl — write-enable flag tests
// ---------------------------------------------------------------------------

describe('ClaudeTeamAdminClientImpl write-enable flag', () => {
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    originalEnv.CLAUDE_TEAM_WRITE_ENABLED = process.env.CLAUDE_TEAM_WRITE_ENABLED;
  });

  afterEach(() => {
    if (originalEnv.CLAUDE_TEAM_WRITE_ENABLED === undefined) {
      delete process.env.CLAUDE_TEAM_WRITE_ENABLED;
    } else {
      process.env.CLAUDE_TEAM_WRITE_ENABLED = originalEnv.CLAUDE_TEAM_WRITE_ENABLED;
    }
  });

  describe('when CLAUDE_TEAM_WRITE_ENABLED is absent', () => {
    beforeEach(() => {
      delete process.env.CLAUDE_TEAM_WRITE_ENABLED;
    });

    it('inviteMember throws ClaudeTeamWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.inviteMember({ email: 'test@example.com' })).rejects.toThrow(
        ClaudeTeamWriteDisabledError,
      );
    });

    it('suspendMember throws ClaudeTeamWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.suspendMember('mem-1')).rejects.toThrow(ClaudeTeamWriteDisabledError);
    });

    it('removeMember throws ClaudeTeamWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.removeMember('mem-1')).rejects.toThrow(ClaudeTeamWriteDisabledError);
    });
  });

  describe('when CLAUDE_TEAM_WRITE_ENABLED is set to a non-"1" value', () => {
    beforeEach(() => {
      process.env.CLAUDE_TEAM_WRITE_ENABLED = 'true';
    });

    it('inviteMember throws ClaudeTeamWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.inviteMember({ email: 'test@example.com' })).rejects.toThrow(
        ClaudeTeamWriteDisabledError,
      );
    });

    it('removeMember throws ClaudeTeamWriteDisabledError', async () => {
      const client = makeClient();
      await expect(client.removeMember('mem-1')).rejects.toThrow(ClaudeTeamWriteDisabledError);
    });
  });

  describe('when CLAUDE_TEAM_WRITE_ENABLED=1', () => {
    beforeEach(() => {
      process.env.CLAUDE_TEAM_WRITE_ENABLED = '1';
      // Stub global fetch so tests don't hit the real network.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockRejectedValue(new TypeError('fetch is stubbed — no network')),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('inviteMember passes the flag check (throws network error, not ClaudeTeamWriteDisabledError)', async () => {
      const client = makeClient();
      await expect(client.inviteMember({ email: 'test@example.com' })).rejects.toThrow(
        ClaudeTeamApiError,
      );
      await expect(client.inviteMember({ email: 'test@example.com' })).rejects.not.toThrow(
        ClaudeTeamWriteDisabledError,
      );
    });

    it('suspendMember passes the flag check and resolves (no-op per OQ-003)', async () => {
      const client = makeClient();
      // suspendMember is a no-op — it should resolve without calling fetch.
      await expect(client.suspendMember('mem-1')).resolves.toBeUndefined();
    });

    it('removeMember passes the flag check (throws network error, not ClaudeTeamWriteDisabledError)', async () => {
      const client = makeClient();
      await expect(client.removeMember('mem-1')).rejects.toThrow(ClaudeTeamApiError);
      await expect(client.removeMember('mem-1')).rejects.not.toThrow(ClaudeTeamWriteDisabledError);
    });
  });

  describe('listMembers — read-only, no write-enable flag required', () => {
    beforeEach(() => {
      delete process.env.CLAUDE_TEAM_WRITE_ENABLED;
      // Stub fetch to return a 200 with empty members list.
      vi.stubGlobal(
        'fetch',
        vi.fn().mockResolvedValue({
          ok: true,
          status: 200,
          json: async () => ({ members: [] }),
        }),
      );
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('listMembers does not require CLAUDE_TEAM_WRITE_ENABLED and returns members', async () => {
      const client = makeClient();
      const members = await client.listMembers();
      expect(members).toEqual([]);
    });
  });
});

// ---------------------------------------------------------------------------
// FakeClaudeTeamAdminClient — unit tests
// ---------------------------------------------------------------------------

describe('FakeClaudeTeamAdminClient', () => {
  let fake: FakeClaudeTeamAdminClient;

  beforeEach(() => {
    fake = new FakeClaudeTeamAdminClient();
  });

  describe('default behaviour', () => {
    it('inviteMember records call and returns default member', async () => {
      const params = { email: 'alice@example.com' };
      const result = await fake.inviteMember(params);
      expect(result.email).toBe('alice@example.com');
      expect(result.status).toBe('pending');
      expect(result.id).toBe('fake-claude-member-id');
      expect(fake.calls.inviteMember).toHaveLength(1);
      expect(fake.calls.inviteMember[0]).toEqual(params);
    });

    it('suspendMember records call and resolves (no-op)', async () => {
      await fake.suspendMember('mem-1');
      expect(fake.calls.suspendMember).toEqual(['mem-1']);
    });

    it('removeMember records call and resolves', async () => {
      await fake.removeMember('mem-2');
      expect(fake.calls.removeMember).toEqual(['mem-2']);
    });

    it('listMembers records call and returns empty array by default', async () => {
      const result = await fake.listMembers();
      expect(result).toEqual([]);
      expect(fake.calls.listMembers).toHaveLength(1);
    });
  });

  describe('configure()', () => {
    it('overrides inviteMember return value', async () => {
      const customMember = { id: 'custom-id', email: 'bob@example.com', status: 'active', role: 'admin' };
      fake.configure('inviteMember', customMember);
      const result = await fake.inviteMember({ email: 'bob@example.com' });
      expect(result).toEqual(customMember);
    });

    it('overrides listMembers return value', async () => {
      const members = [{ id: 'x', email: 'x@x.com', status: 'active' }];
      fake.configure('listMembers', members);
      const result = await fake.listMembers();
      expect(result).toEqual(members);
    });
  });

  describe('configureError()', () => {
    it('makes inviteMember throw the configured error', async () => {
      const err = new ClaudeTeamApiError('invite failed', 'inviteMember', 422);
      fake.configureError('inviteMember', err);
      await expect(fake.inviteMember({ email: 'x@x.com' })).rejects.toThrow(err);
      // Call is still recorded even when it throws
      expect(fake.calls.inviteMember).toHaveLength(1);
    });

    it('makes removeMember throw ClaudeTeamMemberNotFoundError', async () => {
      const err = new ClaudeTeamMemberNotFoundError('bad-id', 'removeMember');
      fake.configureError('removeMember', err);
      await expect(fake.removeMember('bad-id')).rejects.toThrow(ClaudeTeamMemberNotFoundError);
    });
  });

  describe('reset()', () => {
    it('clears recorded calls and configured overrides', async () => {
      await fake.inviteMember({ email: 'a@a.com' });
      fake.configure('listMembers', [{ id: 'x', email: 'x@x.com', status: 'active' }]);
      fake.configureError('removeMember', new Error('boom'));

      fake.reset();

      expect(fake.calls.inviteMember).toHaveLength(0);
      expect(fake.calls.suspendMember).toHaveLength(0);
      expect(fake.calls.removeMember).toHaveLength(0);
      expect(fake.calls.listMembers).toHaveLength(0);

      // After reset, defaults apply again
      const members = await fake.listMembers();
      expect(members).toEqual([]);

      // After reset, error override is gone
      await expect(fake.removeMember('x')).resolves.toBeUndefined();
    });
  });
});
