/**
 * Unit tests for FakeAnthropicAdminClient (Sprint 010 T008).
 *
 * Covers:
 *  - All interface methods record calls and return defaults
 *  - configure() overrides return values (both new and legacy alias names)
 *  - configureError() makes methods throw
 *  - reset() clears calls and overrides
 *  - Backward-compat alias methods: inviteMember, suspendMember, removeMember, listMembers
 *  - calls.inviteMember and calls.inviteToOrg share the same array
 *  - calls.removeMember and calls.deleteOrgUser share the same array
 *  - FakeAnthropicAdminClient implements AnthropicAdminClient interface
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  FakeAnthropicAdminClient,
  FakeClaudeTeamAdminClient,
  AnthropicAdminApiError,
  AnthropicAdminNotFoundError,
  AnthropicAdminWriteDisabledError,
} from '../../helpers/fake-anthropic-admin.client.js';
import type { AnthropicAdminClient } from '../../../../server/src/services/anthropic/anthropic-admin.client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFake(): FakeAnthropicAdminClient {
  return new FakeAnthropicAdminClient();
}

// ---------------------------------------------------------------------------
// Interface implementation check
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — interface compliance', () => {
  it('is assignable to AnthropicAdminClient', () => {
    // This is a compile-time check. If this file compiles, the fake implements
    // the interface.
    const fake: AnthropicAdminClient = new FakeAnthropicAdminClient();
    expect(fake).toBeDefined();
  });

  it('FakeClaudeTeamAdminClient is the same class as FakeAnthropicAdminClient', () => {
    expect(FakeClaudeTeamAdminClient).toBe(FakeAnthropicAdminClient);
  });
});

// ---------------------------------------------------------------------------
// Error class re-exports
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — error class re-exports', () => {
  it('re-exports AnthropicAdminApiError', () => {
    const err = new AnthropicAdminApiError('msg', 'method', 500);
    expect(err.name).toBe('AnthropicAdminApiError');
    expect(err.statusCode).toBe(500);
  });

  it('re-exports AnthropicAdminNotFoundError', () => {
    const err = new AnthropicAdminNotFoundError('not found', 'getOrgUser');
    expect(err.statusCode).toBe(404);
  });

  it('re-exports AnthropicAdminWriteDisabledError', () => {
    const err = new AnthropicAdminWriteDisabledError();
    expect(err.message).toContain('CLAUDE_TEAM_WRITE_ENABLED=1');
  });
});

// ---------------------------------------------------------------------------
// Default return values
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — default return values', () => {
  let fake: FakeAnthropicAdminClient;

  beforeEach(() => {
    fake = makeFake();
  });

  it('listOrgUsers returns empty paged result', async () => {
    const result = await fake.listOrgUsers();
    expect(result.data).toEqual([]);
    expect(result.nextCursor).toBeUndefined();
  });

  it('listOrgUsers accepts optional cursor', async () => {
    const result = await fake.listOrgUsers('cursor-abc');
    expect(result.data).toEqual([]);
    expect(fake.calls.listOrgUsers).toContain('cursor-abc');
  });

  it('getOrgUser returns a synthetic user with the given id', async () => {
    const user = await fake.getOrgUser('user-123');
    expect(user.id).toBe('user-123');
    expect(user.email).toContain('user-123');
    expect(user.role).toBe('user');
  });

  it('deleteOrgUser resolves void', async () => {
    await expect(fake.deleteOrgUser('uid-1')).resolves.toBeUndefined();
  });

  it('inviteToOrg returns fake-claude-member-id with status=pending', async () => {
    const invite = await fake.inviteToOrg({ email: 'alice@example.com' });
    expect(invite.id).toBe('fake-claude-member-id');
    expect(invite.email).toBe('alice@example.com');
    expect(invite.status).toBe('pending');
    expect(invite.role).toBe('user');
  });

  it('inviteToOrg uses provided role', async () => {
    const invite = await fake.inviteToOrg({ email: 'alice@example.com', role: 'admin' });
    expect(invite.role).toBe('admin');
  });

  it('listInvites returns empty paged result', async () => {
    const result = await fake.listInvites();
    expect(result.data).toEqual([]);
  });

  it('cancelInvite resolves void', async () => {
    await expect(fake.cancelInvite('inv-1')).resolves.toBeUndefined();
  });

  it('listWorkspaces returns empty array', async () => {
    const result = await fake.listWorkspaces();
    expect(result).toEqual([]);
  });

  it('addUserToWorkspace resolves void', async () => {
    await expect(fake.addUserToWorkspace('ws-1', 'uid-1')).resolves.toBeUndefined();
  });

  it('removeUserFromWorkspace resolves void', async () => {
    await expect(fake.removeUserFromWorkspace('ws-1', 'uid-1')).resolves.toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Call recording — new interface methods
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — call recording (new methods)', () => {
  let fake: FakeAnthropicAdminClient;

  beforeEach(() => {
    fake = makeFake();
  });

  it('records listOrgUsers calls with cursor arg', async () => {
    await fake.listOrgUsers();
    await fake.listOrgUsers('cursor-1');
    expect(fake.calls.listOrgUsers).toHaveLength(2);
    expect(fake.calls.listOrgUsers[0]).toBeUndefined();
    expect(fake.calls.listOrgUsers[1]).toBe('cursor-1');
  });

  it('records getOrgUser calls with userId', async () => {
    await fake.getOrgUser('u1');
    expect(fake.calls.getOrgUser).toEqual(['u1']);
  });

  it('records deleteOrgUser calls with userId', async () => {
    await fake.deleteOrgUser('uid-abc');
    expect(fake.calls.deleteOrgUser).toEqual(['uid-abc']);
  });

  it('records inviteToOrg calls with params', async () => {
    const params = { email: 'bob@example.com', role: 'user' };
    await fake.inviteToOrg(params);
    expect(fake.calls.inviteToOrg).toHaveLength(1);
    expect(fake.calls.inviteToOrg[0]).toEqual(params);
  });

  it('records cancelInvite calls with inviteId', async () => {
    await fake.cancelInvite('inv-xyz');
    expect(fake.calls.cancelInvite).toEqual(['inv-xyz']);
  });

  it('records listWorkspaces calls', async () => {
    await fake.listWorkspaces();
    expect(fake.calls.listWorkspaces).toHaveLength(1);
  });

  it('records addUserToWorkspace calls', async () => {
    await fake.addUserToWorkspace('ws-1', 'uid-2', 'workspace_user');
    expect(fake.calls.addUserToWorkspace).toHaveLength(1);
    expect(fake.calls.addUserToWorkspace[0]).toEqual({ workspaceId: 'ws-1', userId: 'uid-2', role: 'workspace_user' });
  });

  it('records removeUserFromWorkspace calls', async () => {
    await fake.removeUserFromWorkspace('ws-2', 'uid-3');
    expect(fake.calls.removeUserFromWorkspace).toHaveLength(1);
    expect(fake.calls.removeUserFromWorkspace[0]).toEqual({ workspaceId: 'ws-2', userId: 'uid-3' });
  });
});

// ---------------------------------------------------------------------------
// Call recording — alias invariants
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — alias array invariants', () => {
  let fake: FakeAnthropicAdminClient;

  beforeEach(() => {
    fake = makeFake();
  });

  it('calls.inviteMember and calls.inviteToOrg are the same array', () => {
    expect(fake.calls.inviteMember).toBe(fake.calls.inviteToOrg);
  });

  it('calls.removeMember and calls.deleteOrgUser are the same array', () => {
    expect(fake.calls.removeMember).toBe(fake.calls.deleteOrgUser);
  });

  it('inviteToOrg populates both calls.inviteToOrg and calls.inviteMember', async () => {
    await fake.inviteToOrg({ email: 'x@x.com' });
    expect(fake.calls.inviteToOrg).toHaveLength(1);
    expect(fake.calls.inviteMember).toHaveLength(1);
  });

  it('deleteOrgUser populates both calls.deleteOrgUser and calls.removeMember', async () => {
    await fake.deleteOrgUser('uid-1');
    expect(fake.calls.deleteOrgUser).toHaveLength(1);
    expect(fake.calls.removeMember).toHaveLength(1);
  });
});

// ---------------------------------------------------------------------------
// configure() — new method names
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — configure() new names', () => {
  let fake: FakeAnthropicAdminClient;

  beforeEach(() => {
    fake = makeFake();
  });

  it('overrides inviteToOrg return value', async () => {
    const custom = { id: 'custom-id', email: 'c@c.com', role: 'user', status: 'active' };
    fake.configure('inviteToOrg', custom);
    const result = await fake.inviteToOrg({ email: 'c@c.com' });
    expect(result.id).toBe('custom-id');
    expect(result.status).toBe('active');
  });

  it('overrides listOrgUsers return value', async () => {
    const users = [{ id: 'u1', email: 'a@b.com', role: 'user' }];
    fake.configure('listOrgUsers', { data: users, nextCursor: 'next-page' });
    const result = await fake.listOrgUsers();
    expect(result.data).toEqual(users);
    expect(result.nextCursor).toBe('next-page');
  });

  it('overrides listWorkspaces return value', async () => {
    const workspaces = [{ id: 'ws1', name: 'Main' }];
    fake.configure('listWorkspaces', workspaces);
    const result = await fake.listWorkspaces();
    expect(result).toEqual(workspaces);
  });
});

// ---------------------------------------------------------------------------
// configure() — legacy alias names
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — configure() legacy aliases', () => {
  let fake: FakeAnthropicAdminClient;

  beforeEach(() => {
    fake = makeFake();
  });

  it('configure("inviteMember", ...) applies to inviteToOrg', async () => {
    const custom = { id: 'mem-id', email: 'x@x.com', status: 'active' };
    fake.configure('inviteMember', custom);
    // invoke via new name
    const via_new = await fake.inviteToOrg({ email: 'x@x.com' });
    expect(via_new.id).toBe('mem-id');
    // invoke via legacy name
    const via_old = await fake.inviteMember({ email: 'x@x.com' });
    expect(via_old.id).toBe('mem-id');
  });

  it('configure("listMembers", ...) applies to listMembers', async () => {
    const members = [{ id: 'x', email: 'x@x.com', status: 'active' }];
    fake.configure('listMembers', members);
    const result = await fake.listMembers();
    expect(result).toEqual(members);
  });
});

// ---------------------------------------------------------------------------
// configureError() — new method names
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — configureError() new names', () => {
  let fake: FakeAnthropicAdminClient;

  beforeEach(() => {
    fake = makeFake();
  });

  it('makes inviteToOrg throw configured error', async () => {
    const err = new AnthropicAdminApiError('invite fail', 'inviteToOrg', 422);
    fake.configureError('inviteToOrg', err);
    await expect(fake.inviteToOrg({ email: 'x@x.com' })).rejects.toThrow(err);
    // Call is still recorded
    expect(fake.calls.inviteToOrg).toHaveLength(1);
  });

  it('makes deleteOrgUser throw AnthropicAdminNotFoundError', async () => {
    const err = new AnthropicAdminNotFoundError('not found', 'deleteOrgUser');
    fake.configureError('deleteOrgUser', err);
    await expect(fake.deleteOrgUser('gone')).rejects.toThrow(AnthropicAdminNotFoundError);
    expect(fake.calls.deleteOrgUser).toHaveLength(1);
  });

  it('makes listOrgUsers throw AnthropicAdminApiError', async () => {
    const err = new AnthropicAdminApiError('list fail', 'listOrgUsers', 500);
    fake.configureError('listOrgUsers', err);
    await expect(fake.listOrgUsers()).rejects.toThrow(AnthropicAdminApiError);
  });
});

// ---------------------------------------------------------------------------
// configureError() — legacy alias names
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — configureError() legacy aliases', () => {
  let fake: FakeAnthropicAdminClient;

  beforeEach(() => {
    fake = makeFake();
  });

  it('configureError("inviteMember", ...) applies to inviteToOrg', async () => {
    const err = new AnthropicAdminWriteDisabledError();
    fake.configureError('inviteMember', err);
    await expect(fake.inviteToOrg({ email: 'x@x.com' })).rejects.toThrow(AnthropicAdminWriteDisabledError);
    await expect(fake.inviteMember({ email: 'x@x.com' })).rejects.toThrow(AnthropicAdminWriteDisabledError);
  });

  it('configureError("removeMember", ...) applies to deleteOrgUser', async () => {
    const err = new AnthropicAdminNotFoundError('not found', 'deleteOrgUser');
    fake.configureError('removeMember', err);
    await expect(fake.deleteOrgUser('uid')).rejects.toThrow(AnthropicAdminNotFoundError);
    await expect(fake.removeMember('uid')).rejects.toThrow(AnthropicAdminNotFoundError);
  });
});

// ---------------------------------------------------------------------------
// reset()
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — reset()', () => {
  it('clears all recorded calls', async () => {
    const fake = makeFake();
    await fake.inviteToOrg({ email: 'a@a.com' });
    await fake.deleteOrgUser('uid-1');
    await fake.listOrgUsers();
    await fake.listWorkspaces();
    await fake.suspendMember('m1');
    await fake.listMembers();

    fake.reset();

    expect(fake.calls.inviteToOrg).toHaveLength(0);
    expect(fake.calls.inviteMember).toHaveLength(0); // same array
    expect(fake.calls.deleteOrgUser).toHaveLength(0);
    expect(fake.calls.removeMember).toHaveLength(0); // same array
    expect(fake.calls.listOrgUsers).toHaveLength(0);
    expect(fake.calls.listWorkspaces).toHaveLength(0);
    expect(fake.calls.suspendMember).toHaveLength(0);
    expect(fake.calls.listMembers).toHaveLength(0);
  });

  it('clears return overrides — defaults apply after reset', async () => {
    const fake = makeFake();
    fake.configure('inviteToOrg', { id: 'custom', email: 'x@x.com', status: 'active', role: 'user' });
    fake.reset();
    const invite = await fake.inviteToOrg({ email: 'x@x.com' });
    expect(invite.id).toBe('fake-claude-member-id');
  });

  it('clears error overrides — methods resolve after reset', async () => {
    const fake = makeFake();
    fake.configureError('deleteOrgUser', new Error('fail'));
    fake.reset();
    await expect(fake.deleteOrgUser('uid')).resolves.toBeUndefined();
  });

  it('alias arrays remain the same references after reset', () => {
    const fake = makeFake();
    const inviteRef = fake.calls.inviteToOrg;
    const removeRef = fake.calls.deleteOrgUser;
    fake.reset();
    expect(fake.calls.inviteToOrg).toBe(inviteRef);
    expect(fake.calls.inviteMember).toBe(inviteRef);
    expect(fake.calls.deleteOrgUser).toBe(removeRef);
    expect(fake.calls.removeMember).toBe(removeRef);
  });
});

// ---------------------------------------------------------------------------
// Backward-compat methods
// ---------------------------------------------------------------------------

describe('FakeAnthropicAdminClient — backward-compat methods', () => {
  let fake: FakeAnthropicAdminClient;

  beforeEach(() => {
    fake = makeFake();
  });

  it('inviteMember records in calls.inviteMember (= calls.inviteToOrg)', async () => {
    const params = { email: 'a@a.com' };
    await fake.inviteMember(params);
    expect(fake.calls.inviteMember).toHaveLength(1);
    expect(fake.calls.inviteMember[0]).toEqual(params);
    expect(fake.calls.inviteToOrg).toHaveLength(1);
  });

  it('inviteMember returns fake-claude-member-id by default', async () => {
    const result = await fake.inviteMember({ email: 'a@a.com' });
    expect(result.id).toBe('fake-claude-member-id');
    expect(result.status).toBe('pending');
  });

  it('suspendMember records in calls.suspendMember', async () => {
    await fake.suspendMember('mem-1');
    expect(fake.calls.suspendMember).toEqual(['mem-1']);
  });

  it('removeMember records in calls.removeMember (= calls.deleteOrgUser)', async () => {
    await fake.removeMember('uid-xyz');
    expect(fake.calls.removeMember).toHaveLength(1);
    expect(fake.calls.removeMember[0]).toBe('uid-xyz');
    expect(fake.calls.deleteOrgUser).toHaveLength(1);
  });

  it('listMembers records in calls.listMembers', async () => {
    await fake.listMembers();
    expect(fake.calls.listMembers).toHaveLength(1);
  });

  it('listMembers returns empty array by default', async () => {
    const result = await fake.listMembers();
    expect(result).toEqual([]);
  });

  it('suspendMember does NOT touch calls.deleteOrgUser', async () => {
    await fake.suspendMember('mem-1');
    expect(fake.calls.deleteOrgUser).toHaveLength(0);
  });
});
