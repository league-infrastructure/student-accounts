---
status: pending
---

# Plan — Close sprint 018

## Context

Sprint 018 (`Template Reset, Admin Impersonation, and Docs Migration`) is ready to close. All 15 tickets are now functionally implemented:

- Tickets 001–009: original scope (domain strip, counter demo, demo login, app shell, impersonation)
- Tickets 011–015: social login & account linking
- Ticket 010: docs migration (just completed at commit `5287eb2`)

The ticket 010 programmer flagged **pre-existing test failures** introduced by the OOP (out-of-process) commits made between tickets 015 and 010:

- Server: 1 failure in `tests/server/impersonate-routes.test.ts` — "calling stop-impersonating when not impersonating returns 400". The OOP permissions removal (commit `5bf6972`) likely shifted a status code or changed the not-impersonating response path.
- Client: 4 failures across `tests/client/AppLayout.test.tsx` and `tests/client/UsersPanel.test.tsx`. Caused by:
  - User area moved from topbar to bottom-left sidebar (OOP)
  - Configuration sidebar link removed (OOP)
  - Admin dashboard panel deleted (OOP)
  - MCP Setup moved from sidebar nav to Account modal (OOP)

These failures are **stale expectations**, not regressions in behavior — the UI works; the tests assert on the old DOM structure.

Sprint-review will fail if these are not fixed. The CLASI `close_sprint` skill requires sprint-review pass.

## Approach

**Two-step close-out:**

1. **Fix the stale tests** as an out-of-process cleanup commit on the sprint branch (the OOP changes that broke them were themselves out-of-process, so the test updates belong in the same lane).
2. **Invoke sprint-review**, then **close_sprint**.

We considered marking sprint 018 "done with known failing tests" and spinning the fixes into a new sprint — rejected because the tests are trivial updates and leaving red tests on master is worse than the 15 extra minutes to fix them.

## Scope — test updates

### Server

- `tests/server/impersonate-routes.test.ts` — update the "stop-impersonating when not impersonating" expectation to match whatever the current endpoint returns. Investigate if this is actually behavioral drift or just a status-code mismatch; fix either the test or the endpoint to match the ticket 008 spec (400 was the original expected code).

### Client

- `tests/client/AppLayout.test.tsx` — update assertions that looked for:
  - user area in topbar (now in sidebar bottom-left)
  - "MCP Setup" in sidebar (now removed; lives on Account modal)
  - "Configuration" sidebar entry (removed)
  - "Admin > Dashboard" nav (removed)
- `tests/client/UsersPanel.test.tsx` — check impersonate button → redirects with `window.location.assign('/')` instead of `.reload()` (changed per user request after ticket 009).

## Scope — sprint closure

1. Commit the test fixes with a message like `chore(018): update tests after OOP UI changes`.
2. Run `cd server && npm run test:server` and `cd client && npm run test:client` — must be all-green.
3. Invoke the `sprint-review` skill (validates all tickets done, tests pass, process followed).
4. If review passes: invoke `close_sprint` skill (archives sprint directory to `done/`, merges sprint branch to master, deletes branch).
5. Verify sprint is in `docs/clasi/sprints/done/018-template-reset-admin-impersonation-and-docs-migration/` and branch is gone.
6. Report to user.

## Critical files

- [tests/server/impersonate-routes.test.ts](tests/server/impersonate-routes.test.ts)
- [tests/client/AppLayout.test.tsx](tests/client/AppLayout.test.tsx)
- [tests/client/UsersPanel.test.tsx](tests/client/UsersPanel.test.tsx)

## Verification

After close:

1. `git branch --list` — sprint/018-* is gone
2. `ls docs/clasi/sprints/done/` — includes `018-template-reset-admin-impersonation-and-docs-migration/`
3. `git log --oneline master -3` — shows the merged sprint work on master
4. `npm run test:server` and `npm run test:client` from master — both pass

## Out of scope

- Any new feature work
- Adding test coverage beyond what's needed to get to green
- Rewriting OOP changes into proper tickets retroactively
