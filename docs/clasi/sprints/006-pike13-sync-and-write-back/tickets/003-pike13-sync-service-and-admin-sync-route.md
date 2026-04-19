---
id: "003"
title: "Pike13 sync service and admin sync route"
status: todo
use-cases: [UC-004]
depends-on: ["001"]
github-issue: ""
todo: ""
---

# Pike13 sync service and admin sync route

## Description

Implement `Pike13SyncService` which executes the full Pike13 people sync
(UC-004): paginate all people from Pike13, match against existing Users by
Pike13 ExternalAccount `external_id` or `primary_email`, create User +
ExternalAccount(type=pike13) rows for unmatched records, invoke the merge scan
stub for each new User, and return a count report.

Also add the `POST /admin/sync/pike13` route that invokes the service and
returns the count report as JSON.

## Acceptance Criteria

- [ ] `server/src/services/pike13/pike13-sync.service.ts` exists.
- [ ] Paginates all Pike13 people using `Pike13ApiClient.listPeople` until
  `nextCursor` is null.
- [ ] For each person: checks for existing ExternalAccount(type=pike13,
  external_id=person.id) first, then falls back to matching by `primary_email`.
- [ ] Unmatched person: creates User (role=student, created_via=pike13_sync,
  display_name=first_name+' '+last_name, primary_email=person.email) and
  ExternalAccount (type=pike13, external_id=person.id, status=active).
- [ ] Calls `mergeScan` stub for each newly created User.
- [ ] Returns `SyncReport` with `{ created, matched, skipped, errors, errorDetails }`.
- [ ] Person missing email: record is skipped and counted in `skipped`; sync
  continues.
- [ ] Pike13 API error mid-pagination: increments `errors` for that page; sync
  continues with remaining pages (fail-soft per record, not per page).
- [ ] AuditEvent recorded: action=pike13_sync_completed, details include counts.
- [ ] AuditEvent recorded per newly created User (action=create_user).
- [ ] `POST /admin/sync/pike13` route exists in `server/src/routes/admin/sync.ts`;
  returns 200 with `SyncReport` JSON; protected by `requireAuth + requireRole('admin')`.
- [ ] `Pike13SyncService` is registered in `ServiceRegistry`.
- [ ] Integration tests cover: full happy-path (create+match), skipped
  (no email), API error on one page, empty Pike13 result.

## Implementation Plan

### Approach

1. Create `Pike13SyncService` that accepts `Pike13ApiClient` (injected),
   `UserRepository` (or `UserService`), `ExternalAccountRepository`,
   `AuditService`, and `MergeScanStub` as constructor dependencies.
2. Implement the pagination loop using `listPeople` cursor.
3. Implement match logic: query ExternalAccount by type+external_id; if not
   found, query User by primary_email.
4. Implement upsert path for new Users.
5. Create `server/src/routes/admin/sync.ts` with the `POST /admin/sync/pike13`
   handler. This route file will also be extended by ticket 007 for Workspace
   sync endpoints.
6. Register service in `ServiceRegistry`; mount router in `app.ts`.
7. Write integration tests using `FakePike13ApiClient`.

### Files to Create

- `server/src/services/pike13/pike13-sync.service.ts`
- `server/src/routes/admin/sync.ts`
- `tests/server/services/pike13/pike13-sync.service.test.ts`

### Files to Modify

- `server/src/services/pike13/index.ts` — export `Pike13SyncService`
- `server/src/services/service.registry.ts` — register `Pike13SyncService`
- `server/src/app.ts` — mount `/admin/sync` router

### Testing Plan

- Integration tests with `FakePike13ApiClient` seeded with known people data.
- Scenarios: all-new users created, all-existing users matched, mixed, no email
  (skipped), API error on page 2 (partial results).
- Route integration test: 403 for non-admin, 200 + SyncReport for admin.

### Documentation Updates

- None beyond what is already in the architecture update.
