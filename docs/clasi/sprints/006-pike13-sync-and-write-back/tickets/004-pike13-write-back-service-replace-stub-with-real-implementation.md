---
id: "004"
title: "Pike13 write-back service: replace stub with real implementation"
status: todo
use-cases: [UC-020]
depends-on: ["001"]
github-issue: ""
todo: ""
---

# Pike13 write-back service: replace stub with real implementation

## Description

Replace `server/src/services/pike13-writeback.stub.ts` with a real
implementation that uses `Pike13ApiClient` to update Pike13 custom fields.
The new module exports the same two functions (`leagueEmail`, `githubHandle`)
at a new path `server/src/services/pike13/pike13-writeback.service.ts`. Two
call sites must update their import path.

The write-back functions must never throw (Pike13 API failures are caught,
logged at ERROR, and an audit event is recorded). The primary actions
(Workspace provisioning and GitHub Login add) must not be rolled back by a
write-back failure.

## Acceptance Criteria

- [ ] `server/src/services/pike13/pike13-writeback.service.ts` exists.
- [ ] `leagueEmail(userId, email)` — looks up active Pike13 ExternalAccount for
  the user; if found, calls `Pike13ApiClient.updateCustomField` with
  `PIKE13_CUSTOM_FIELD_EMAIL_ID` and the email address; records
  action=pike13_writeback_email AuditEvent.
- [ ] `githubHandle(userId, handle)` — same flow, uses
  `PIKE13_CUSTOM_FIELD_GITHUB_ID` and the GitHub username; records
  action=pike13_writeback_github.
- [ ] No Pike13 ExternalAccount: function returns without error (no-op).
- [ ] Pike13 API failure: error is caught, logged at ERROR, AuditEvent records
  the failure; function returns (does not re-throw).
- [ ] Old stub `server/src/services/pike13-writeback.stub.ts` is deleted.
- [ ] `server/src/services/workspace-provisioning.service.ts` import updated to
  new path.
- [ ] `server/src/routes/admin/user-logins.ts` import updated to new path.
- [ ] TypeScript compiles cleanly after path update.
- [ ] Integration tests: leagueEmail with active Pike13 account (calls
  updateCustomField), leagueEmail with no Pike13 account (no-op),
  githubHandle with API failure (no throw, error logged).

## Implementation Plan

### Approach

1. Create `pike13-writeback.service.ts` in `server/src/services/pike13/`.
2. Implement `leagueEmail` and `githubHandle` using `ExternalAccountRepository`
   to find the Pike13 ExternalAccount, then `Pike13ApiClientImpl` (instantiated
   directly inside the module, reading env vars — not injected — to preserve the
   module-function export shape required by existing call sites).
3. Wrap the `updateCustomField` call in try/catch; log and audit on failure.
4. Delete the old stub.
5. Update the two call sites.

### Files to Create

- `server/src/services/pike13/pike13-writeback.service.ts`
- `tests/server/services/pike13/pike13-writeback.service.test.ts`

### Files to Delete

- `server/src/services/pike13-writeback.stub.ts`

### Files to Modify

- `server/src/services/pike13/index.ts` — export the two write-back functions
- `server/src/services/workspace-provisioning.service.ts` — update import path
- `server/src/routes/admin/user-logins.ts` — update import path

### Testing Plan

- Integration tests using `FakePike13ApiClient` (injected via Jest module mock
  or module-level override).
- Scenarios: active Pike13 account + success, active Pike13 account + API error
  (no throw), no Pike13 account (no-op), missing env var for field ID (logged
  error, no throw).

### Documentation Updates

- None. Architecture update already documents the path change and the no-throw
  contract.
