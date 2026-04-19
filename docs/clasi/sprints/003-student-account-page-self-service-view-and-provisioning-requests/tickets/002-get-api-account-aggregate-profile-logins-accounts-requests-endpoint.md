---
id: "002"
title: "GET /api/account — aggregate profile/logins/accounts/requests endpoint"
status: todo
use-cases: [SUC-001]
depends-on: ["001"]
github-issue: ""
todo: ""
---

# GET /api/account — aggregate profile/logins/accounts/requests endpoint

## Description

Create the `server/src/routes/account.ts` route module with the aggregate
`GET /api/account` endpoint. This is the data source for the entire
AccountPage: it returns the signed-in student's profile, logins, external
accounts, and provisioning requests in one response.

The module also serves as the home for the other account routes built in
T003 and T004. This ticket creates the module skeleton and the GET endpoint.

## Acceptance Criteria

- [ ] `GET /api/account` returns 200 with an `AccountData` JSON response for
      an authenticated student.
- [ ] Response includes `profile` (id, displayName, primaryEmail, cohort
      name or null, role, createdAt).
- [ ] Response includes `logins` (id, provider, providerEmail,
      providerUsername, createdAt) — all logins for the signed-in user.
- [ ] Response includes `externalAccounts` (id, type, status, externalId,
      createdAt) — all external accounts for the signed-in user.
- [ ] Response includes `provisioningRequests` (id, requestedType, status,
      createdAt, decidedAt) — all provisioning requests for the signed-in
      user, most recent first.
- [ ] `GET /api/account` returns 401 when no session exists.
- [ ] `GET /api/account` returns 403 when the session user has role=staff or
      role=admin.
- [ ] Data is strictly scoped to `req.session.userId` — no cross-user data
      is returned.
- [ ] Route module is mounted at `/api` in `server/src/app.ts`.

## Implementation Plan

### Approach

Create `server/src/routes/account.ts`. Mount it in `app.ts` after the auth
routes. Every handler applies `requireAuth` then `requireRole('student')`.

The GET handler calls four service methods (UserService.findById,
LoginService.findByUserId, ExternalAccountService.findByUserId,
ProvisioningRequestService.findByUser) and composes the response. These are
read-only and can run sequentially or in parallel with Promise.all.

### Files to Create

- `server/src/routes/account.ts` — new route module (skeleton + GET handler)

### Files to Modify

- `server/src/app.ts` — mount account routes

### Testing Plan

Integration tests in `tests/server/routes/account.test.ts`.

Test cases:
1. Authenticated student with profile/logins/accounts/requests — full payload
   returned, each field present.
2. Unauthenticated request — 401.
3. Authenticated staff user — 403.
4. Authenticated admin user — 403.
5. Student with no cohort — `profile.cohort` is null.
6. Student with no external accounts or provisioning requests — empty arrays
   returned (not omitted).
