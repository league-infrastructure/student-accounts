---
id: "004"
title: "Investigate Google Workspace sync cohort-writes; redirect to Group-writes if applicable"
status: todo
use-cases:
  - SUC-007
depends-on: []
github-issue: ""
todo: ""
completes_todo: false
---

# Investigate Google Workspace sync cohort-writes; redirect to Group-writes if applicable

## Description

The stakeholder wants Google Workspace OUs to sync as Groups (not Cohorts)
going forward. Existing Cohort rows are left in place (no data migration this
sprint). This ticket investigates whether `WorkspaceSyncService.syncCohorts`
currently writes Cohort rows and, if so, redirects those writes to the Group
model.

The service header confirms it uses `CohortService` and `CohortRepository`.
The investigation determines whether those code paths are actually reachable
at runtime (e.g., whether the Google client is configured, whether the OU
root env var is set) and what would need to change.

## Acceptance Criteria

- [ ] Read `server/src/services/workspace-sync.service.ts` `syncCohorts` method in full and document what it does.
- [ ] Determine whether `syncCohorts` is currently called and whether it creates Cohort rows in any environment (dev or prod). Check the sync route and the scheduler for call sites.

**If `syncCohorts` creates Cohort rows:**
- [ ] Replace `CohortService` / `CohortRepository` writes with equivalent `GroupService` writes. Each OU that would have become a Cohort becomes a Group with the same name.
- [ ] Add `upsertByName(name: string, tx?)` to `GroupService` (or use an equivalent existing method) if one does not exist.
- [ ] Remove `CohortService` and `CohortRepository` from `WorkspaceSyncService` constructor/imports if they are no longer used after the redirect.
- [ ] Rename or replace `WorkspaceSyncReport.cohortsUpserted` with `groupsUpserted`; update the sync route's response and any callers that inspect this field.
- [ ] The sync route handler and scheduler call sites are updated to expect `groupsUpserted` in the report.

**If `syncCohorts` does NOT create Cohort rows (e.g., Google client is unconfigured):**
- [ ] Add a code comment in `syncCohorts` noting that cohort-writes were intentionally stopped as of sprint 025 and that the method is a no-op or routes to Groups.
- [ ] No functional code change is required; close the ticket with a documentation note.

## Implementation Plan

### Approach

1. Read `syncCohorts` fully. Read the sync scheduler and sync route to confirm call sites.
2. Grep for `cohortService` and `CohortRepository` usage in the sync service.
3. If writes are active, implement the redirect using `GroupService`. The simplest implementation is to call `GroupService.findOrCreate` (or add `upsertByName`) for each OU name, mirroring the cohort upsert pattern.
4. Update `WorkspaceSyncReport` type and all consumers.

### Files potentially to modify

- `server/src/services/workspace-sync.service.ts`
- `server/src/services/group.service.ts` (may add `upsertByName`)
- Sync route or scheduler that consumes `WorkspaceSyncReport` (locate via grep)

### Testing plan

- If a code change is made: extend or add a test in `tests/server/services/workspace-sync.service.test.ts` asserting that `syncCohorts` creates Group rows, not Cohort rows, when OUs are returned.
- If no code change: the existing tests (if any) continue to pass unchanged.
- Run: `npm run test:server -- --testPathPattern workspace-sync`

### Documentation updates

Add a comment in `syncCohorts` noting the sprint 025 cohort-to-group redirect decision regardless of whether code changed.
