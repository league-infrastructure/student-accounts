---
id: "008"
title: "Admin API routes — external account lifecycle and Claude provisioning"
status: done
use-cases: [SUC-001, SUC-004, SUC-005]
depends-on: ["004", "005"]
---

# Admin API routes — external account lifecycle and Claude provisioning

## Description

Create the server-side API routes for individual ExternalAccount suspend/remove
and Claude seat provisioning. These are thin route handlers that parse input,
call the appropriate service, and return the result.

New routes:

| Method | Path | Service | Description |
|---|---|---|---|
| POST | `/admin/external-accounts/:id/suspend` | ExternalAccountLifecycleService.suspend | Suspend one account |
| POST | `/admin/external-accounts/:id/remove` | ExternalAccountLifecycleService.remove | Remove one account |
| POST | `/admin/users/:id/provision-claude` | ClaudeProvisioningService.provision | Provision Claude seat |

All routes require `requireAuth` + `requireRole('admin')`.

## Acceptance Criteria

- [x] `server/src/routes/admin/external-accounts.ts` created with suspend and remove routes.
- [x] POST /admin/external-accounts/:id/suspend: calls lifecycle service suspend, returns 200 with updated account.
- [x] POST /admin/external-accounts/:id/remove: calls lifecycle service remove, returns 200 with updated account.
- [x] POST /admin/users/:id/provision-claude: calls ClaudeProvisioningService.provision (wrapping in prisma.$transaction), returns 201.
- [x] All routes: 403 returned for non-admin callers.
- [x] All routes: 404 returned when account/user does not exist.
- [x] Suspend: 422 returned when account is already suspended/removed (service throws UnprocessableError).
- [x] Provision-claude: 422 returned when workspace account missing.
- [x] Provision-claude: 409 returned when claude account already exists.
- [x] New external-accounts router mounted in `server/src/routes/admin/index.ts` at `/admin`.
- [x] Route integration tests pass.

## Implementation Plan

### Approach

1. Create `server/src/routes/admin/external-accounts.ts` with the Router.
2. Add `provision-claude` endpoint to `server/src/routes/admin/users.ts`.
3. Mount the new router in `app.ts`.

Each route handler:
- Parses `:id` as integer; returns 400 on NaN.
- Gets services from `req.services` (ServiceRegistry pattern).
- Opens `prisma.$transaction` for the provision-claude route (the service
  method takes a tx).
- Catches typed errors and maps to HTTP status codes:
  - `NotFoundError` → 404
  - `ConflictError` → 409
  - `UnprocessableError` → 422

### Files to create/modify

- `server/src/routes/admin/external-accounts.ts` (new)
- `server/src/routes/admin/users.ts` (add provision-claude endpoint)
- `server/src/app.ts` (mount external-accounts router)

### Testing plan

Route integration tests in `tests/server/routes/admin/external-accounts.test.ts`
and extended `tests/server/routes/admin/users.test.ts`:
- Suspend: success returns 200, status updated.
- Suspend: non-admin 403.
- Suspend: already suspended 422.
- Remove: success returns 200, workspace scheduled_delete_at set.
- Remove: non-admin 403.
- Provision-claude: success 201, ExternalAccount created.
- Provision-claude: no workspace account 422.
- Provision-claude: already has claude 409.
- Provision-claude: non-admin 403.

### Documentation updates

None.
