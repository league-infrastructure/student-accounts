/**
 * @deprecated Use FakeAnthropicAdminClient from ./fake-anthropic-admin.client.js instead.
 *
 * This file is a backward-compatibility shim. It re-exports
 * FakeAnthropicAdminClient under the legacy FakeClaudeTeamAdminClient name so
 * existing test files that import from this path continue to compile and run
 * without modification.
 *
 * FakeAnthropicAdminClient is a drop-in replacement: it implements
 * AnthropicAdminClient and exposes backward-compat method aliases
 * (inviteMember, suspendMember, removeMember, listMembers) and call record
 * aliases (calls.inviteMember = calls.inviteToOrg, etc.).
 */

export {
  FakeAnthropicAdminClient,
  FakeAnthropicAdminClient as FakeClaudeTeamAdminClient,
  type FakeAnthropicAdminCallRecords as FakeClaudeTeamCallRecords,
  AnthropicAdminApiError,
  AnthropicAdminNotFoundError,
  AnthropicAdminWriteDisabledError,
} from './fake-anthropic-admin.client.js';
