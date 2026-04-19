---
id: '001'
title: Pike13 API client module
status: done
use-cases: [UC-004, UC-020]
depends-on: []
github-issue: ''
todo: plan-workspace-app-sync-create-todo-artifact.md
---

# Pike13 API client module

## Description

Create the `Pike13ApiClient` module that provides all Pike13 REST API
operations needed by this application. This is the foundation for both the
sync (UC-004) and write-back (UC-020) epics; no Pike13 work can proceed
without it.

The module lives under `server/src/services/pike13/`. Before implementing,
confirm the Pike13 API documentation for: pagination style (cursor vs.
offset vs. page number), authentication scheme, and the custom field update
endpoint. These are captured as OQ-001 and OQ-002 in the architecture update.

## Acceptance Criteria

- [x] `server/src/services/pike13/pike13-api.client.ts` exists and exports the
  `Pike13ApiClient` interface and `Pike13ApiClientImpl` class.
- [x] `listPeople(cursor?)` — calls the Pike13 people endpoint, returns
  `Pike13PeoplePage` with `people[]` and `nextCursor | null`.
- [x] `getPerson(personId)` — returns `Pike13Person` for the given ID.
- [x] `updateCustomField(personId, fieldId, value)` — updates a custom field
  on a person; respects `PIKE13_WRITE_ENABLED` flag.
- [x] `Pike13WriteDisabledError` thrown when `updateCustomField` is called
  and `PIKE13_WRITE_ENABLED !== '1'`.
- [x] `Pike13ApiError` thrown on any HTTP error response.
- [x] `Pike13PersonNotFoundError` thrown when person ID does not exist (404).
- [x] All credential env vars (`PIKE13_API_URL`, `PIKE13_ACCESS_TOKEN`) are read
  from `process.env`; missing vars cause a clear startup-time or call-time
  error message.
- [x] `server/src/services/pike13/index.ts` re-exports the client interface,
  impl class, and error classes.
- [x] A fake implementation `tests/server/helpers/fake-pike13-api.client.ts`
  exists: records all calls, returns configurable responses, never makes
  network calls.
- [x] Unit tests for: write-enable flag enforcement, error mapping (HTTP 404 →
  `Pike13PersonNotFoundError`, other HTTP errors → `Pike13ApiError`), and
  happy-path call signatures.

## Implementation Plan

### Approach

1. Review Pike13 API documentation to confirm pagination, auth, and custom
   field update endpoint. Adjust `Pike13PeoplePage` interface accordingly.
2. Create `server/src/services/pike13/` directory.
3. Implement `Pike13ApiClientImpl` using `fetch` or `axios` (whichever is
   already used in the codebase — check existing clients).
4. Map Pike13 HTTP errors to typed error classes.
5. Implement `FakePike13ApiClient` in the tests helpers directory.
6. Write unit tests.

### Files to Create

- `server/src/services/pike13/pike13-api.client.ts`
- `server/src/services/pike13/index.ts`
- `tests/server/helpers/fake-pike13-api.client.ts`
- `tests/server/services/pike13/pike13-api.client.test.ts`

### Files to Modify

- `config/dev/secrets.env.example` — add `PIKE13_API_URL`, `PIKE13_API_KEY`,
  `PIKE13_WRITE_ENABLED`, `PIKE13_CUSTOM_FIELD_GITHUB_ID`,
  `PIKE13_CUSTOM_FIELD_EMAIL_ID`

### Testing Plan

- Unit tests cover: flag enforcement, error mapping, call structure.
- Integration tests are deferred to ticket 003 (sync service) and 004
  (write-back service) which use the fake client.

### Documentation Updates

- Deployment prerequisites note in architecture-update.md already covers the
  env var requirements. Update `config/dev/secrets.env.example`.
