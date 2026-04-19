---
id: '004'
title: "POST /api/account/provisioning-requests \u2014 create request(s) with constraint\
  \ enforcement and audit"
status: done
use-cases:
- SUC-004
- SUC-005
depends-on:
- '001'
- '002'
github-issue: ''
todo: ''
---

# POST /api/account/provisioning-requests — create request(s) with constraint enforcement and audit

## Description

Add `POST /api/account/provisioning-requests` and
`GET /api/account/provisioning-requests` to the account route module.

The POST endpoint exposes the `ProvisioningRequestService.create` method built
in T001 to the HTTP layer. The constraint enforcement (Claude-requires-League-
email) lives entirely in the service; this route handler is a thin adapter:
parse body, call service, format response.

## Acceptance Criteria

- [x] `POST /api/account/provisioning-requests` with `{ "requestType": "workspace" }`
      returns 201 with the created ProvisioningRequest object.
- [x] `POST` with `{ "requestType": "workspace_and_claude" }` returns 201 with
      an array of two ProvisioningRequest objects (or a wrapper object).
- [x] `POST` with an unrecognized `requestType` returns 400.
- [x] `POST` when the workspace conflict exists returns 409.
- [x] `POST` with `requestType` that would include claude but no workspace
      baseline exists returns 422 with an error message explaining the
      League email prerequisite.
- [x] `POST` returns 401 when unauthenticated.
- [x] `POST` returns 403 for staff or admin roles.
- [x] `GET /api/account/provisioning-requests` returns the list of all
      provisioning requests for the signed-in user, ordered most-recent-first.
- [x] `GET` returns 401 when unauthenticated, 403 for staff/admin.

## Implementation Plan

### Approach

Add POST and GET handlers to `server/src/routes/account.ts`. Both use the
service from T001. The route validates `requestType` with a string enum check
before calling the service (early 400, no service call needed for invalid
input).

Body parsing: use `express.json()` already applied globally. Validate
`requestType` is one of `['workspace', 'workspace_and_claude']`.

Error mapping:
- `ConflictError` from service → 409
- `UnprocessableError` from service → 422
- Other errors → centralized error handler

### Files to Modify

- `server/src/routes/account.ts` — add POST and GET handlers
- `server/src/errors.ts` — verify `UnprocessableError` is present (add if T001
  did not add it)

### Testing Plan

Route-level integration tests in `tests/server/routes/account.test.ts`:

1. POST workspace — 201, one request row in DB.
2. POST workspace_and_claude with no workspace baseline — 422.
3. POST workspace_and_claude with pending workspace request — 201, two rows.
4. POST duplicate workspace — 409.
5. POST invalid requestType — 400.
6. GET — returns user's requests; empty array when none.
7. POST unauthenticated — 401.
8. POST staff role — 403.

Service-layer constraint tests are in T001; route tests verify HTTP status
codes and response shapes only.
