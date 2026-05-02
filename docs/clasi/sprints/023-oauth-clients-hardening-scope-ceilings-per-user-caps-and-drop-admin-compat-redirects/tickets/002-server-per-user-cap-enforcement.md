---
id: "002"
title: "Server — per-user cap enforcement"
status: todo
use-cases:
  - SUC-023-001
  - SUC-023-002
depends-on: []
github-issue: ""
todo: ""
completes_todo: false
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Server — per-user cap enforcement

## Description

There is currently no limit on how many OAuth clients a single user can
register. Stakeholder direction (2026-05-01) caps students at one client;
staff and admin have no limit.

This ticket introduces a `ClientCapPolicy` module and enforces the cap in
`OAuthClientService.create`. Cap violations are audited.

**Policy (from stakeholder direction 2026-05-01):**

| Role | Max Clients |
|------|-------------|
| `student` | 1 |
| `staff` | unlimited |
| `admin` | unlimited |

Note: disabled clients (`disabled_at IS NOT NULL`) do not count toward the cap.

## Acceptance Criteria

- [ ] `server/src/services/oauth/client-cap-policy.ts` exists and exports:
  - `ClientCapPolicy.maxClientsFor(role: string): number | null` — `null` means unlimited.
  - `ClientCapPolicy.assertUnderCap(role: string, currentCount: number): void` — throws `ForbiddenError` (with `code: 'CLIENT_CAP_REACHED'`) when count >= cap.
- [ ] `OAuthClientService.create` counts non-disabled clients owned by `actorUserId` (`where: { created_by: actorUserId, disabled_at: null }`) and calls `ClientCapPolicy.assertUnderCap(actor.actorRole, count)` when `actor` is provided.
- [ ] On cap violation, an audit event `oauth_client_create_rejected_cap` is recorded with `{ role: actor.actorRole, current_count: count, cap: maxClientsFor(role) }` in `details`.
- [ ] Student with zero clients can create one → 201.
- [ ] Student with one active client cannot create a second → 403.
- [ ] Student who disabled their one client can create a new one → 201 (disabled not counted).
- [ ] Staff with N clients can always create another → 201.
- [ ] Admin with N clients can always create another → 201.
- [ ] Cap rejection is visible in the audit log.

## Implementation Plan

### Approach

`ClientCapPolicy` is a pure module (no DB access). The count query lives in
`OAuthClientService.create`, keeping the DB interaction inside the service.

Coordinate with ticket 001: both tickets modify `OAuthClientService.create`'s
signature to accept `actor?: ActorContext`. Whoever implements first should
leave the parameter in place. The two checks are sequenced: cap check first,
then scope check (a user over-cap should know they need to disable a client
before worrying about scopes).

### Files to Create

- `server/src/services/oauth/client-cap-policy.ts` — cap table + two exports.

### Files to Modify

- `server/src/services/oauth/oauth-client.service.ts`:
  - Add `import { ClientCapPolicy } from './client-cap-policy.js'`
  - In `create`: before the `prisma.$transaction`, count non-disabled owned clients and call `ClientCapPolicy.assertUnderCap`. On cap violation, call `this.audit.record` with `oauth_client_create_rejected_cap` then re-throw (or throw directly — audit must happen even when create fails).
  - Audit event should be recorded outside the transaction that creates the client (it records a rejection, not a creation).

### Testing Plan

Extend `tests/server/routes/oauth-clients.test.ts` or
`tests/server/services/oauth/oauth-client.service.test.ts`:
- Student: 0 clients → create → 201.
- Student: 1 active client → create → 403.
- Student: 1 disabled client → create → 201.
- Staff: 2 existing clients → create → 201.
- Admin: 2 existing clients → create → 201.
- Cap rejection: audit event recorded (query audit log or spy on `audit.record`).

### Documentation Updates

No doc changes beyond ticket 005's TODO comment removal in the client.
