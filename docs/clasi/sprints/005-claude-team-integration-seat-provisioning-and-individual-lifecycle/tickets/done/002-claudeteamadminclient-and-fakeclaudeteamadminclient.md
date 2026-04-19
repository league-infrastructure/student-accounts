---
id: '002'
title: ClaudeTeamAdminClient and FakeClaudeTeamAdminClient
status: done
use-cases:
- SUC-001
- SUC-004
- SUC-005
depends-on: []
---

# ClaudeTeamAdminClient and FakeClaudeTeamAdminClient

## Description

Implement the `ClaudeTeamAdminClient` module and its in-memory fake for
integration tests. This is the API layer for all Claude Team admin operations:
invite member, suspend member, remove member, list members.

The client follows the same patterns established for `GoogleWorkspaceAdminClient`
in Sprint 004: typed interface, write-enable flag, typed error classes, no
business logic.

**Note on OQ-002 and OQ-003:** Before implementing, check the Claude Team API
documentation for the exact credential format and whether a "suspend" operation
is supported. If suspend is not a first-class API operation, `suspendMember`
should be implemented as a no-op (or omitted) and documented accordingly.

## Acceptance Criteria

- [x] `server/src/services/claude-team/claude-team-admin.client.ts` created with the `ClaudeTeamAdminClient` interface and implementation.
- [x] Interface exports: `inviteMember(params)`, `suspendMember(memberId)`, `removeMember(memberId)`, `listMembers()`.
- [x] `CLAUDE_TEAM_WRITE_ENABLED=1` must be set for any mutating call; throws `ClaudeTeamWriteDisabledError` otherwise.
- [x] Typed error classes: `ClaudeTeamWriteDisabledError`, `ClaudeTeamApiError`, `ClaudeTeamMemberNotFoundError`.
- [x] `server/src/services/claude-team/index.ts` exports the client and error types.
- [x] `tests/server/helpers/fake-claude-team-admin.client.ts` created — records all calls for assertion, returns configurable responses, never makes network calls.
- [x] Unit tests: write-enable flag absent throws `ClaudeTeamWriteDisabledError`.
- [x] Unit tests: write-enable flag present allows calls.

## Implementation Plan

### Approach

1. Create `server/src/services/claude-team/` directory.
2. Implement the interface and class in `claude-team-admin.client.ts`. The
   implementation loads `CLAUDE_TEAM_API_KEY` and `CLAUDE_TEAM_PRODUCT_ID` from
   env. HTTP calls go to the Claude Team API base URL. Check API docs for exact
   endpoint paths.
3. Implement the write-enable flag check (throw `ClaudeTeamWriteDisabledError`
   when `CLAUDE_TEAM_WRITE_ENABLED !== '1'`) at the top of each mutating method.
4. Create `index.ts` to re-export.
5. Create the fake client in `tests/server/helpers/`.

### Files to create

- `server/src/services/claude-team/claude-team-admin.client.ts`
- `server/src/services/claude-team/index.ts`
- `tests/server/helpers/fake-claude-team-admin.client.ts`

### Testing plan

- `tests/server/services/claude-team-admin.client.test.ts` — unit tests for the
  write-enable flag and error classes (no network calls; inject a mock HTTP layer
  or use the fake).
- Run full test suite to confirm no regressions.

### Documentation updates

- Add `CLAUDE_TEAM_API_KEY`, `CLAUDE_TEAM_PRODUCT_ID`, `CLAUDE_TEAM_WRITE_ENABLED`
  to `config/dev/secrets.env.example` and `config/prod/secrets.env.example`.
