---
id: "002"
title: "Server: GroupService.userPermissions helper + unit tests"
status: todo
use-cases:
  - SUC-002
depends-on:
  - "001"
github-issue: ""
todo: ""
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server: GroupService.userPermissions helper + unit tests

## Description

Add `GroupService.userPermissions(userId)` — the single source of truth for computing
a user's effective permissions by taking the additive union across all their groups.

Multi-group rule: a user gets a permission if ANY of their groups has the corresponding
flag set to `true`. Returns `{ oauthClient: boolean, llmProxy: boolean, leagueAccount: boolean }`.

This helper will be called by route handlers before invoking permission-gated service
methods (tickets 003, 004, 005).

## Acceptance Criteria

- [ ] `GroupService` has a `userPermissions(userId: number)` method returning `{ oauthClient: boolean, llmProxy: boolean, leagueAccount: boolean }`.
- [ ] User in zero groups returns all three `false`.
- [ ] User in one group with `allowsOauthClient=true` returns `oauthClient: true`.
- [ ] User in two groups where only one has `allowsLlmProxy=true` returns `llmProxy: true`.
- [ ] User in two groups where both have `allowsLeagueAccount=false` returns `leagueAccount: false`.
- [ ] User in two groups each with a different permission returns the correct union.
- [ ] Unit/integration tests cover all branches above and pass (`npm run test:server`).

## Implementation Plan

### Approach

Add the method to `server/src/services/group.service.ts`. Query `UserGroup` rows for
the user, include the group's permission fields, reduce to the union struct.

### Files to modify

- `server/src/services/group.service.ts` — add `userPermissions(userId)` method

### Files to create

- `tests/server/services/group-permissions.test.ts` — unit tests for `userPermissions`
  (or extend an existing group service test file)

### Implementation sketch

```typescript
async userPermissions(userId: number): Promise<{
  oauthClient: boolean;
  llmProxy: boolean;
  leagueAccount: boolean;
}> {
  const memberships = await (this.prisma as any).userGroup.findMany({
    where: { user_id: userId },
    include: {
      group: {
        select: {
          allowsOauthClient: true,
          allowsLlmProxy: true,
          allowsLeagueAccount: true,
        },
      },
    },
  });
  return {
    oauthClient: memberships.some((m: any) => m.group.allowsOauthClient),
    llmProxy: memberships.some((m: any) => m.group.allowsLlmProxy),
    leagueAccount: memberships.some((m: any) => m.group.allowsLeagueAccount),
  };
}
```

### Testing plan

Test cases:
- Zero groups → all false.
- One group, one flag true → correct flag true, others false.
- Two groups, different flags → correct union.
- Two groups, same flag in both → still true (idempotent union).
- All three flags true across different groups → all three true in result.

Use the dev SQLite test database (same pattern as other service tests).

### Documentation updates

None required for this ticket.
