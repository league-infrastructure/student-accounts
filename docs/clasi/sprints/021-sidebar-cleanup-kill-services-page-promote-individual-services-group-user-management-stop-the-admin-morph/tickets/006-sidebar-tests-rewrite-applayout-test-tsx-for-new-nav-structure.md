---
id: "006"
title: "Sidebar tests — rewrite AppLayout.test.tsx for new nav structure"
status: todo
use-cases:
  - SUC-001
  - SUC-002
  - SUC-003
  - SUC-004
  - SUC-005
depends-on:
  - "001"
  - "002"
  - "003"
  - "004"
  - "005"
github-issue: ""
todo: ""
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sidebar tests — rewrite AppLayout.test.tsx for new nav structure

## Description

Rewrite `tests/client/AppLayout.test.tsx` to assert the new single-nav
structure produced by tickets 001–005. The old tests asserted `APP_NAV` items
and the `isAdminSection` morph, which no longer exist.

The existing test file should be deleted and replaced with a fresh file that
covers the new invariants. Read the existing file first to understand the
testing patterns and mock setup used — preserve useful patterns (auth mocking,
route rendering setup) but replace all nav assertions.

### Test cases to cover

**Role: student**
- Sees: OAuth Clients, About.
- Does not see: User Management group, Admin group, Dashboard, Sync,
  Account (in sidebar), Services.
- Claude Code and LLM Proxy: both absent when account has no entitlements.
- Claude Code appears when account data includes a `claude` ExternalAccount.
- LLM Proxy appears when `account.profile.llmProxyEnabled === true`.

**Role: staff**
- Sees: OAuth Clients, User Management group (Staff Directory child), About.
- Does not see: Admin group, Dashboard, Sync, Users (admin-only child),
  Cohorts, Groups within User Management.
- Clicking User Management header navigates to `/staff/directory`.

**Role: admin**
- Sees: OAuth Clients, User Management group (all children), Dashboard, Sync,
  Admin group (all 8 ops links), About.
- User Management children include: Staff Directory, Users, League Students,
  LLM Proxy Users, Cohorts, Groups.

**No-morph invariant**
- Render with initial path `/admin/env`.
- Assert that the sidebar items are identical to rendering with path `/account`.
- Specifically: no "Back to App" link; no ADMIN_NAV-only items appearing while
  normal items disappear.

**User Management group expand / default-child navigate**
- Render as staff. User Management group is collapsed.
- Click the User Management header.
- Assert: group expands to show children; navigation to `/staff/directory` is triggered.

**Server test baseline**
- `npm run test:server` passes unchanged.

## Acceptance Criteria

- [ ] `tests/client/AppLayout.test.tsx` has been rewritten (old assertions removed).
- [ ] Student role test: correct items visible; no User Management, Admin group, Dashboard, Sync.
- [ ] Student entitlement test: Claude Code absent without `claude` ExternalAccount; present with it.
- [ ] Student entitlement test: LLM Proxy absent when `llmProxyEnabled` is false; present when true.
- [ ] Staff role test: User Management group visible; admin-only children hidden.
- [ ] Admin role test: all groups and flat admin items visible.
- [ ] No-morph test: sidebar items identical at `/admin/env` vs `/account`.
- [ ] Group navigate test: clicking User Management header triggers navigation to `/staff/directory`.
- [ ] `npm run test:client` passes with 0 unexpected failures.
- [ ] `npm run test:server` baseline unchanged.

## Implementation Plan

### Approach

1. Read the existing `tests/client/AppLayout.test.tsx` to understand the mock
   patterns for `useAuth`, `useQuery`, and React Router.
2. Delete the body of the file (keeping imports that are still useful).
3. Write new test suites following the cases above.
4. For the entitlement gate tests, mock `useQuery(['account'])` to return
   account data with/without the `claude` ExternalAccount and with/without
   `llmProxyEnabled`.
5. For the no-morph test, use React Router's `MemoryRouter` with initial
   entries set to `/admin/env` and assert the same items as a render at `/`.
6. Run `npm run test:client` until all new tests pass.

### Files to modify

- `tests/client/AppLayout.test.tsx` — full rewrite

### Testing plan

- This ticket IS the testing deliverable for the sprint's nav changes.
- Run `npm run test:client` and `npm run test:server` at the end.

### Documentation updates

None — this ticket is pure testing work.
