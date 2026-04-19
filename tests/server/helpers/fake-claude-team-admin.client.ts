/**
 * FakeClaudeTeamAdminClient — test double for ClaudeTeamAdminClient.
 *
 * Implements the ClaudeTeamAdminClient interface using in-memory state.
 * No network calls are made. All methods record their invocations in the
 * `calls` object for test assertions.
 *
 * Configurable behavior:
 *  - `configure(method, value)` — set a return value for a method (overrides
 *    the built-in default).
 *  - `configureError(method, error)` — make a method throw an error.
 *  - `reset()` — clear all recorded calls and configured overrides.
 *
 * Default return values (when no override is configured):
 *  - `inviteMember` → { id: 'fake-claude-member-id', email: params.email, status: 'pending' }
 *  - `suspendMember` → resolves void (no-op, mirroring the real impl — OQ-003)
 *  - `removeMember`  → resolves void
 *  - `listMembers`   → []
 *
 * Usage in tests:
 *
 *   const fake = new FakeClaudeTeamAdminClient();
 *
 *   // Override a return value
 *   fake.configure('inviteMember', { id: 'x', email: 'alice@example.com', status: 'active' });
 *
 *   // Make a method throw
 *   fake.configureError('removeMember', new ClaudeTeamMemberNotFoundError('bad-id', 'removeMember'));
 *
 *   // Assert calls
 *   expect(fake.calls.inviteMember).toHaveLength(1);
 *   expect(fake.calls.inviteMember[0].email).toBe('alice@example.com');
 *
 *   // Reset between tests
 *   fake.reset();
 */

import type {
  ClaudeTeamAdminClient,
  InviteMemberParams,
  ClaudeTeamMember,
} from '../../../server/src/services/claude-team/claude-team-admin.client.js';

// ---------------------------------------------------------------------------
// Call recorder types
// ---------------------------------------------------------------------------

export interface FakeClaudeTeamCallRecords {
  inviteMember: InviteMemberParams[];
  suspendMember: string[];
  removeMember: string[];
  listMembers: undefined[];
}

// ---------------------------------------------------------------------------
// Method return value overrides (keyed by method name)
// ---------------------------------------------------------------------------

type MethodReturnOverrides = {
  inviteMember?: ClaudeTeamMember;
  suspendMember?: void;
  removeMember?: void;
  listMembers?: ClaudeTeamMember[];
};

type MethodErrorOverrides = {
  [K in keyof MethodReturnOverrides]?: Error;
};

// ---------------------------------------------------------------------------
// FakeClaudeTeamAdminClient
// ---------------------------------------------------------------------------

export class FakeClaudeTeamAdminClient implements ClaudeTeamAdminClient {
  /** Recorded call arguments, indexed by method name. */
  readonly calls: FakeClaudeTeamCallRecords = {
    inviteMember: [],
    suspendMember: [],
    removeMember: [],
    listMembers: [],
  };

  private returnOverrides: MethodReturnOverrides = {};
  private errorOverrides: MethodErrorOverrides = {};

  /**
   * Configure a return value for a method. Overrides the built-in default.
   *
   * @param method - The method name to configure.
   * @param value  - The value to return when the method is called.
   */
  configure<K extends keyof MethodReturnOverrides>(method: K, value: MethodReturnOverrides[K]): void {
    this.returnOverrides[method] = value;
  }

  /**
   * Configure a method to throw an error when called.
   *
   * @param method - The method name to configure.
   * @param error  - The error to throw.
   */
  configureError<K extends keyof MethodErrorOverrides>(method: K, error: Error): void {
    this.errorOverrides[method] = error;
  }

  /**
   * Reset all recorded calls and configured overrides.
   * Call between tests to ensure test isolation.
   */
  reset(): void {
    this.calls.inviteMember = [];
    this.calls.suspendMember = [];
    this.calls.removeMember = [];
    this.calls.listMembers = [];
    this.returnOverrides = {};
    this.errorOverrides = {};
  }

  // ---------------------------------------------------------------------------
  // Interface methods
  // ---------------------------------------------------------------------------

  async inviteMember(params: InviteMemberParams): Promise<ClaudeTeamMember> {
    this.calls.inviteMember.push(params);
    if (this.errorOverrides.inviteMember) {
      throw this.errorOverrides.inviteMember;
    }
    return (
      this.returnOverrides.inviteMember ?? {
        id: 'fake-claude-member-id',
        email: params.email,
        // OQ-001: default to "pending" to reflect the most likely real API
        // behaviour for new invites. Override via configure() if your test
        // needs "active".
        status: 'pending',
        role: params.role ?? 'user',
      }
    );
  }

  async suspendMember(memberId: string): Promise<void> {
    this.calls.suspendMember.push(memberId);
    if (this.errorOverrides.suspendMember) {
      throw this.errorOverrides.suspendMember;
    }
    // OQ-003: mirrors the real impl's no-op behaviour.
  }

  async removeMember(memberId: string): Promise<void> {
    this.calls.removeMember.push(memberId);
    if (this.errorOverrides.removeMember) {
      throw this.errorOverrides.removeMember;
    }
  }

  async listMembers(): Promise<ClaudeTeamMember[]> {
    this.calls.listMembers.push(undefined);
    if (this.errorOverrides.listMembers) {
      throw this.errorOverrides.listMembers;
    }
    return this.returnOverrides.listMembers ?? [];
  }
}
