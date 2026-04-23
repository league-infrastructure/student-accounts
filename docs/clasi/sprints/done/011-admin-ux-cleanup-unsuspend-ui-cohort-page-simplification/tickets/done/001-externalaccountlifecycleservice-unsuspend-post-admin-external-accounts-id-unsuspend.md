---
id: '001'
title: ExternalAccountLifecycleService.unsuspend + POST /admin/external-accounts/:id/unsuspend
status: done
use-cases:
- SUC-011-001
depends-on: []
github-issue: ''
todo: admin-user-page-unsuspend-ui.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# ExternalAccountLifecycleService.unsuspend + POST /admin/external-accounts/:id/unsuspend

## Description

Add the server half of the admin Unsuspend flow. Introduce a new
`unsuspend(accountId, actorId, tx)` method on
`ExternalAccountLifecycleService` and expose it via
`POST /admin/external-accounts/:id/unsuspend`.

Workspace un-suspend calls the existing
`GoogleWorkspaceAdminClient.unsuspendUser(email)`, flips the row to
`status='active'`, and emits an `unsuspend_workspace` audit event.

Claude un-suspend branches on the `external_id` prefix:
- `invite_*` -> best-effort `cancelInvite(oldId)`, then
  `inviteToOrg({ email: <leagueEmail> })`, persist the new invite id
  as `external_id`, set `status='pending'`, emit `unsuspend_claude`
  audit event.
- `user_*` (or anything else) -> `UnprocessableError` with the
  message "Claude user accounts cannot be un-suspended; delete this
  account and re-provision a new Claude seat instead."

The League email for the invite is derived from the user's workspace
`ExternalAccount.external_id` if present, falling back to
`user.primary_email` when no workspace ExternalAccount exists.

## Acceptance Criteria

- [x] `ExternalAccountLifecycleService.unsuspend(accountId, actorId, tx)` exists and is exported.
- [x] Throws `NotFoundError` if the account does not exist.
- [x] Throws `UnprocessableError` if the account is not currently `suspended`.
- [x] Workspace case: calls `googleClient.unsuspendUser(email)`, sets `status='active'`, sets `status_changed_at=now`, emits `unsuspend_workspace` audit event with `previousStatus` and `externalId` in details.
- [x] Claude invite case: calls `cancelInvite(oldId)` (warn-and-continue on failure), then `inviteToOrg({ email })`, persists the new invite id in `external_id`, sets `status='pending'`, emits `unsuspend_claude` audit event.
- [x] Claude user-id case: throws `UnprocessableError` with the "cannot be un-suspended; delete and re-provision" message; no state change.
- [x] `POST /admin/external-accounts/:id/unsuspend` handler is added inside the existing `adminExternalAccountsRouter`, returning 200 with the updated row, 404 on missing, 422 on precondition failure, 502 on provider errors.
- [x] Unit tests for all three branches pass.
- [x] `npm run test:server` passes.

## Plan

### Files to modify
- `server/src/services/external-account-lifecycle.service.ts`
- `server/src/routes/admin/external-accounts.ts`

### Approach
1. Mirror the existing `suspend` method's structure (fetch-validate-
   call-persist-audit).
2. Derive the League email for the re-invite from:
   - The user's ExternalAccount of type `workspace` with status in
     (`active`, `pending`, `suspended`, `removed`) -- use its
     `external_id`.
   - Else fall back to `user.primary_email`.
   - Else throw `UnprocessableError`.
3. Route handler follows the existing suspend/remove handler shape
   including the `WorkspaceApiError -> 502` mapping.

### Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - service: workspace suspended -> active, audit event written.
  - service: claude invite suspended -> pending, new invite id stored.
  - service: claude user_* suspended -> throws UnprocessableError.
  - service: account not suspended -> throws UnprocessableError.
  - service: nonexistent account -> throws NotFoundError.
  - route: 200 on success, 404 on missing, 422 on precondition.
- **Verification command**: `npm run test:server`
