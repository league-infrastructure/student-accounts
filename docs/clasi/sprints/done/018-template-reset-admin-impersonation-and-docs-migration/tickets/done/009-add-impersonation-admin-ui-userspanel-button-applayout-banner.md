---
id: 009
title: Add impersonation admin UI (UsersPanel button + AppLayout banner)
status: done
use-cases:
- SUC-004
- SUC-005
depends-on:
- '005'
- 008
github-issue: ''
todo: plan-admin-user-impersonation.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 009 — Add impersonation admin UI (UsersPanel button + AppLayout banner)

## Description

Wire up the two client-side impersonation interactions:

1. **UsersPanel** — add an "Impersonate" button to each user row (skip own row) that
   calls `POST /api/admin/users/:id/impersonate` and reloads the page.

2. **AppLayout account dropdown** — when `user.impersonating` is true, show a colored
   banner ("Viewing as: {displayName}") and replace "Log out" with "Stop impersonating"
   (calls `POST /api/admin/stop-impersonating`, then reloads).

Depends on ticket 005 (AuthContext has `impersonating` and `realAdmin` fields) and
ticket 008 (API endpoints exist).

## Files to Modify

**`client/src/pages/admin/UsersPanel.tsx`:**

Read the current component first to understand its table structure. Then:
- Add an "Actions" column to the users table.
- For each row: render an "Impersonate" button.
  - Skip (render nothing) if `row.id === currentUser.id` (own row).
  - On click: call `POST /api/admin/users/${row.id}/impersonate`; on success
    → `window.location.reload()` (refreshes all user-dependent state).
  - Show a loading/disabled state while the request is in-flight.
  - On error: show an inline error message (e.g., toast or row-level message).

**`client/src/components/AppLayout.tsx`:**

Read the current component and find the account dropdown section. Then:
- Import `useAuth` (or equivalent) to access `user.impersonating` and
  `user.realAdmin`.
- When `user.impersonating === true`:
  - Render a colored banner above (or within) the topbar:
    ```
    "Viewing as: {user.displayName}  (real admin: {user.realAdmin.displayName})"
    ```
    Style it distinctively (e.g., yellow background, warning tone).
  - In the account dropdown, replace the "Log out" item with a "Stop impersonating"
    button.
  - "Stop impersonating" onClick:
    ```ts
    await fetch('/api/admin/stop-impersonating', { method: 'POST' });
    window.location.reload();
    ```
- When `user.impersonating !== true`, render the normal "Log out" item.

Note: Do not also add the Configuration nav entry here — that is ticket 006.

## Acceptance Criteria

- [x] UsersPanel renders an "Impersonate" button in each user row
- [x] The button is absent for the current user's own row
- [x] Clicking "Impersonate" calls the endpoint and reloads the page
- [x] After reload, the app presents as the impersonated user (role badge, nav)
- [x] A colored impersonation banner is visible when `user.impersonating === true`
- [x] Banner shows the target user's display name
- [x] Account dropdown shows "Stop impersonating" instead of "Log out" during impersonation
- [x] Clicking "Stop impersonating" calls the endpoint and reloads the page
- [x] After reload, the app presents as the original admin
- [x] Normal "Log out" is restored after stopping impersonation
- [x] TypeScript compiles without errors; `npm run test:client` passes

## Implementation Plan

1. Read `client/src/pages/admin/UsersPanel.tsx` — understand table structure and
   data fetching pattern.
2. Read `client/src/components/AppLayout.tsx` — find account dropdown section (~line 384
   per TODO) and auth state access.
3. Add "Impersonate" button to UsersPanel with fetch + reload on click.
4. Add impersonation banner and "Stop impersonating" item to AppLayout dropdown.
5. Run `npm run build` (client).
6. Manual smoke test: impersonate a user, verify banner, stop impersonating.

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write**:
  - UsersPanel shows Impersonate button on other users' rows
  - UsersPanel does not show Impersonate button on own row
  - AppLayout shows impersonation banner when `user.impersonating` is true
  - AppLayout shows "Stop impersonating" instead of "Log out" when impersonating
- **Verification command**: `npm run build && npm run test:client`
