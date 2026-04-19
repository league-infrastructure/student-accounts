---
id: '001'
title: Extend GET /admin/users to include externalAccountTypes
status: todo
use-cases: [SUC-009-001, SUC-009-004]
depends-on: []
github-issue: ''
todo: plan-users-panel-user-detail-ux-overhaul-create-todo-artifact.md
---

# Extend GET /admin/users to include externalAccountTypes

## Description

The Users panel Accounts filter (T006) needs to know which external account
types each user has (workspace, claude, pike13). The current `GET /admin/users`
response includes `providers` (Login providers) but not external account types.

Add `externalAccountTypes: string[]` to each user object in the response.
This is an additive, non-breaking change.

## Acceptance Criteria

- [ ] `GET /admin/users` response includes `externalAccountTypes` on every user
      object (e.g., `["workspace", "pike13"]`).
- [ ] `externalAccountTypes` lists distinct `type` values from the user's
      `external_accounts` rows regardless of status.
- [ ] Existing fields (`id`, `email`, `displayName`, `role`, `providers`,
      `cohort`, `createdAt`) are unchanged.
- [ ] Server test: GET /admin/users returns correct externalAccountTypes for a
      user with workspace + pike13 accounts, and an empty array for a user with
      none.

## Implementation Plan

**Approach:** Modify `GET /admin/users` in `server/src/routes/admin/users.ts`
to include `external_accounts` in the Prisma query's `include`, then map
distinct types onto the response.

**Files to modify:**
- `server/src/routes/admin/users.ts` — add `external_accounts: { select: { type: true } }`
  to the `include` block; add `externalAccountTypes` to the response map.

**Implementation sketch:**
```typescript
// in the prisma.user.findMany include:
external_accounts: { select: { type: true } },

// in the response map:
externalAccountTypes: [...new Set(user.external_accounts.map(a => a.type))],
```

**Testing plan:**
- Existing test file: `tests/server/admin/users.test.ts` (or equivalent) —
  run to verify no regressions.
- New test: add a case asserting the `externalAccountTypes` field is present
  and correct for a user with mixed account types.

**Documentation updates:** None required — this is an internal API change.
