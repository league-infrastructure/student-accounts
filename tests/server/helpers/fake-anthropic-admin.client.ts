/**
 * FakeAnthropicAdminClient — test double for AnthropicAdminClient.
 *
 * Implements the AnthropicAdminClient interface using in-memory state.
 * No network calls are made. All methods record their invocations in the
 * `calls` object for test assertions.
 *
 * Backward compatibility: this class is also exported as
 * `FakeClaudeTeamAdminClient` so existing test files that import it from
 * `fake-claude-team-admin.client.js` continue to work without import changes.
 * Call arrays are aliased so tests that check `calls.inviteMember` still work
 * when the underlying method called is `inviteToOrg`, and tests that check
 * `calls.removeMember` still work when the underlying method is `deleteOrgUser`.
 *
 * Configurable behavior:
 *  - `configure(method, value)` — set a return value for a method (overrides
 *    the built-in default). Accepts both new names (`inviteToOrg`) and legacy
 *    aliases (`inviteMember`).
 *  - `configureError(method, error)` — make a method throw an error.
 *  - `reset()` — clear all recorded calls and configured overrides.
 *
 * Default return values (when no override is configured):
 *  - `listOrgUsers`           → { data: [], nextCursor: undefined }
 *  - `getOrgUser(id)`         → { id, email: id+'@example.com', role: 'user' }
 *  - `deleteOrgUser`          → resolves void
 *  - `inviteToOrg(params)`    → { id: 'fake-claude-member-id', email: params.email, role: 'user', status: 'pending' }
 *  - `listInvites`            → { data: [], nextCursor: undefined }
 *  - `cancelInvite`           → resolves void
 *  - `listWorkspaces`         → []
 *  - `addUserToWorkspace`     → resolves void
 *  - `removeUserFromWorkspace`→ resolves void
 *
 * Legacy defaults (backward compat aliases):
 *  - `inviteMember`  → same as inviteToOrg
 *  - `removeMember`  → same as deleteOrgUser
 *  - `suspendMember` → records call in calls.suspendMember, resolves void
 *  - `listMembers`   → returns [] by default (or configured override)
 *
 * Usage:
 *
 *   const fake = new FakeAnthropicAdminClient();
 *
 *   // Configure with new name or legacy alias — both work
 *   fake.configure('inviteToOrg', { id: 'x', email: 'alice@example.com', role: 'user', status: 'active' });
 *   fake.configure('inviteMember', { id: 'x', email: 'alice@example.com', status: 'active' }); // same effect
 *
 *   // Both aliases refer to the same recorded calls
 *   expect(fake.calls.inviteToOrg).toHaveLength(1);
 *   expect(fake.calls.inviteMember).toHaveLength(1); // same array
 *
 *   fake.reset();
 */

import type {
  AnthropicAdminClient,
  AnthropicUser,
  AnthropicInvite,
  AnthropicWorkspace,
  AnthropicPagedResult,
  InviteToOrgParams,
} from '../../../server/src/services/anthropic/anthropic-admin.client.js';

// Re-export error classes for convenience in tests that configure errors.
export {
  AnthropicAdminApiError,
  AnthropicAdminNotFoundError,
  AnthropicAdminWriteDisabledError,
} from '../../../server/src/services/anthropic/anthropic-admin.client.js';

// ---------------------------------------------------------------------------
// Call recorder type
// ---------------------------------------------------------------------------

export interface FakeAnthropicAdminCallRecords {
  // New interface methods
  listOrgUsers: Array<string | undefined>;
  getOrgUser: string[];
  deleteOrgUser: string[];
  inviteToOrg: InviteToOrgParams[];
  listInvites: Array<string | undefined>;
  cancelInvite: string[];
  listWorkspaces: undefined[];
  addUserToWorkspace: Array<{ workspaceId: string; userId: string; role?: string }>;
  removeUserFromWorkspace: Array<{ workspaceId: string; userId: string }>;
  // Backward-compat aliases (same array references as the canonical names above)
  /** Same array as inviteToOrg. */
  inviteMember: InviteToOrgParams[];
  /** Same array as deleteOrgUser. */
  removeMember: string[];
  /** Legacy compat — populated by the suspendMember compat method. */
  suspendMember: string[];
  /** Legacy compat — populated by the listMembers compat method. */
  listMembers: undefined[];
}

// ---------------------------------------------------------------------------
// Override maps
// ---------------------------------------------------------------------------

/**
 * A loose member-like type used for legacy override methods.
 * Accepts both old ClaudeTeamMember shapes and new AnthropicUser / AnthropicInvite
 * shapes so existing tests that configure({ id, email, status }) still compile.
 */
type LegacyMemberLike = {
  id: string;
  email: string;
  status?: string;
  role?: string;
  name?: string;
  [key: string]: unknown;
};

type MethodReturnOverrides = {
  // New interface — use loose types so legacy configure() calls compile.
  listOrgUsers?: AnthropicPagedResult<AnthropicUser>;
  getOrgUser?: AnthropicUser;
  deleteOrgUser?: void;
  /**
   * Uses LegacyMemberLike so tests that configure inviteToOrg (or the legacy
   * inviteMember alias) with { id, email, status } (no role) still compile.
   */
  inviteToOrg?: LegacyMemberLike;
  listInvites?: AnthropicPagedResult<AnthropicInvite>;
  cancelInvite?: void;
  listWorkspaces?: AnthropicWorkspace[];
  addUserToWorkspace?: void;
  removeUserFromWorkspace?: void;
  // Legacy compat aliases
  /** Alias for inviteToOrg (same canonical key). */
  inviteMember?: LegacyMemberLike;
  removeMember?: void;
  suspendMember?: void;
  /** Legacy compat — accepts old ClaudeTeamMember shape. */
  listMembers?: LegacyMemberLike[];
};

type MethodErrorOverrides = {
  [K in keyof MethodReturnOverrides]?: Error;
};

// ---------------------------------------------------------------------------
// FakeAnthropicAdminClient
// ---------------------------------------------------------------------------

export class FakeAnthropicAdminClient implements AnthropicAdminClient {
  readonly calls: FakeAnthropicAdminCallRecords;

  private returnOverrides: MethodReturnOverrides = {};
  private errorOverrides: MethodErrorOverrides = {};

  constructor() {
    // Shared array references for alias pairs.
    const inviteToOrgArr: InviteToOrgParams[] = [];
    const deleteOrgUserArr: string[] = [];

    this.calls = {
      listOrgUsers: [],
      getOrgUser: [],
      deleteOrgUser: deleteOrgUserArr,
      inviteToOrg: inviteToOrgArr,
      listInvites: [],
      cancelInvite: [],
      listWorkspaces: [],
      addUserToWorkspace: [],
      removeUserFromWorkspace: [],
      // Aliases share the same array instances
      inviteMember: inviteToOrgArr,
      removeMember: deleteOrgUserArr,
      suspendMember: [],
      listMembers: [],
    };
  }

  /**
   * Configure a return value for a method.
   * Accepts both canonical names (inviteToOrg) and legacy aliases (inviteMember).
   */
  configure<K extends keyof MethodReturnOverrides>(method: K, value: MethodReturnOverrides[K]): void {
    (this.returnOverrides as Record<string, unknown>)[this.canonicalize(method as string)] = value;
  }

  /**
   * Configure a method to throw an error when called.
   * Accepts both canonical names and legacy aliases.
   */
  configureError<K extends keyof MethodErrorOverrides>(method: K, error: Error): void {
    (this.errorOverrides as Record<string, unknown>)[this.canonicalize(method as string)] = error;
  }

  /**
   * Reset all recorded calls and configured overrides.
   */
  reset(): void {
    // Clear in place to preserve alias references.
    this.calls.inviteToOrg.length = 0;
    this.calls.deleteOrgUser.length = 0;
    this.calls.listOrgUsers.length = 0;
    this.calls.getOrgUser.length = 0;
    this.calls.listInvites.length = 0;
    this.calls.cancelInvite.length = 0;
    this.calls.listWorkspaces.length = 0;
    this.calls.addUserToWorkspace.length = 0;
    this.calls.removeUserFromWorkspace.length = 0;
    this.calls.suspendMember.length = 0;
    this.calls.listMembers.length = 0;
    this.returnOverrides = {};
    this.errorOverrides = {};
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private canonicalize(method: string): string {
    switch (method) {
      case 'inviteMember': return 'inviteToOrg';
      case 'removeMember': return 'deleteOrgUser';
      // listMembers and suspendMember kept as-is (handled specially in their methods)
      default: return method;
    }
  }

  // ---------------------------------------------------------------------------
  // AnthropicAdminClient interface methods
  // ---------------------------------------------------------------------------

  async listOrgUsers(cursor?: string): Promise<AnthropicPagedResult<AnthropicUser>> {
    this.calls.listOrgUsers.push(cursor);
    if (this.errorOverrides.listOrgUsers) throw this.errorOverrides.listOrgUsers;
    return this.returnOverrides.listOrgUsers ?? { data: [], nextCursor: undefined };
  }

  async getOrgUser(userId: string): Promise<AnthropicUser> {
    this.calls.getOrgUser.push(userId);
    if (this.errorOverrides.getOrgUser) throw this.errorOverrides.getOrgUser;
    return this.returnOverrides.getOrgUser ?? {
      id: userId,
      email: `${userId}@example.com`,
      role: 'user',
    };
  }

  async deleteOrgUser(userId: string): Promise<void> {
    this.calls.deleteOrgUser.push(userId);
    if (this.errorOverrides.deleteOrgUser) throw this.errorOverrides.deleteOrgUser;
  }

  async inviteToOrg(params: InviteToOrgParams): Promise<AnthropicInvite> {
    this.calls.inviteToOrg.push(params);
    if (this.errorOverrides.inviteToOrg) throw this.errorOverrides.inviteToOrg;
    const override = this.returnOverrides.inviteToOrg;
    if (override !== undefined) {
      // Cast from LegacyMemberLike to AnthropicInvite — compatible at runtime.
      return override as unknown as AnthropicInvite;
    }
    return {
      id: 'fake-claude-member-id',
      email: params.email,
      role: params.role ?? 'user',
      status: 'pending',
    };
  }

  async listInvites(cursor?: string): Promise<AnthropicPagedResult<AnthropicInvite>> {
    this.calls.listInvites.push(cursor);
    if (this.errorOverrides.listInvites) throw this.errorOverrides.listInvites;
    return this.returnOverrides.listInvites ?? { data: [], nextCursor: undefined };
  }

  async cancelInvite(inviteId: string): Promise<void> {
    this.calls.cancelInvite.push(inviteId);
    if (this.errorOverrides.cancelInvite) throw this.errorOverrides.cancelInvite;
  }

  async listWorkspaces(): Promise<AnthropicWorkspace[]> {
    this.calls.listWorkspaces.push(undefined);
    if (this.errorOverrides.listWorkspaces) throw this.errorOverrides.listWorkspaces;
    return this.returnOverrides.listWorkspaces ?? [];
  }

  async addUserToWorkspace(workspaceId: string, userId: string, role?: string): Promise<void> {
    this.calls.addUserToWorkspace.push({ workspaceId, userId, role });
    if (this.errorOverrides.addUserToWorkspace) throw this.errorOverrides.addUserToWorkspace;
  }

  async removeUserFromWorkspace(workspaceId: string, userId: string): Promise<void> {
    this.calls.removeUserFromWorkspace.push({ workspaceId, userId });
    if (this.errorOverrides.removeUserFromWorkspace) throw this.errorOverrides.removeUserFromWorkspace;
  }

  // ---------------------------------------------------------------------------
  // Backward-compat methods (not part of AnthropicAdminClient interface)
  // These exist so test files written against the old ClaudeTeamAdminClient
  // interface compile and run without changes.
  // ---------------------------------------------------------------------------

  /**
   * Backward compat alias for inviteToOrg.
   * Delegates to inviteToOrg; call recorded in calls.inviteMember (= calls.inviteToOrg).
   */
  async inviteMember(params: InviteToOrgParams): Promise<AnthropicInvite> {
    return this.inviteToOrg(params);
  }

  /**
   * Backward compat: suspend is a no-op at the Anthropic API level.
   * Records the call in calls.suspendMember for backward-compat test assertions.
   */
  async suspendMember(memberId: string): Promise<void> {
    this.calls.suspendMember.push(memberId);
    if (this.errorOverrides.suspendMember) throw this.errorOverrides.suspendMember;
  }

  /**
   * Backward compat alias for deleteOrgUser.
   * Delegates to deleteOrgUser; call recorded in calls.removeMember (= calls.deleteOrgUser).
   */
  async removeMember(memberId: string): Promise<void> {
    return this.deleteOrgUser(memberId);
  }

  /**
   * Backward compat. Returns the configured listMembers override if set,
   * otherwise returns the listOrgUsers data without making an additional
   * listOrgUsers call. Records the call in calls.listMembers only.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async listMembers(): Promise<any[]> {
    this.calls.listMembers.push(undefined);
    if (this.errorOverrides.listMembers) throw this.errorOverrides.listMembers;
    if (this.returnOverrides.listMembers !== undefined) {
      return this.returnOverrides.listMembers;
    }
    // Return the listOrgUsers data without triggering a separate listOrgUsers call.
    const paged = this.returnOverrides.listOrgUsers ?? { data: [], nextCursor: undefined };
    return paged.data;
  }
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export { FakeAnthropicAdminClient as FakeClaudeTeamAdminClient };
