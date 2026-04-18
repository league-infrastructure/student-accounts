---
id: '005'
title: Add counter homepage and new login page
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
depends-on:
- '002'
- '003'
- '004'
github-issue: ''
todo: plan-revert-template-app-to-simple-two-button-counter-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 005 — Add counter homepage and new login page

## Description

Create the two primary user-facing pages for the template demo:

1. `HomePage.tsx` — displays `alpha` and `beta` counters fetched via React Query; each
   counter has a button that increments it via `POST /api/counters/:name/increment` and
   triggers a query refetch.

2. New `Login.tsx` (or replacement `LoginPage.tsx`) — username/password form pre-filled
   with `user`/`pass`; POSTs to `/api/auth/demo-login`; shows error on 401; redirects to
   `/` on success.

Also update `AuthContext` with a `loginWithCredentials(username, password)` helper and
extend the `AuthUser` type for impersonation fields that ticket 009 will use.

Wire up the routes in `App.tsx`.

Depends on: ticket 002 (domain pages deleted), 003 (counter API exists), 004 (demo-login
endpoint exists).

## Files to Create

**`client/src/pages/HomePage.tsx`:**
```
- useQuery key: ['counters'] → GET /api/counters → [{ name, value }]
- Renders each counter: name label, current value, "Increment" button
- Button onClick: useMutation → POST /api/counters/:name/increment → invalidateQueries(['counters'])
- Loading and error states handled
```

**`client/src/pages/Login.tsx`** (replaces deleted `LoginPage.tsx`; name to match
existing `Login.tsx` if present — read `client/src/pages/Login.tsx` first to see its
current content):
```
- Form: username input (defaultValue="user"), password input (defaultValue="pass")
- Submit: POST /api/auth/demo-login with { username, password }
- On 200: invalidate AuthContext user query → redirect to /
- On 401: show "Invalid username or password" message
- No OAuth button
```

## Files to Modify

**`client/src/context/AuthContext.tsx`:**
- Add `loginWithCredentials(username: string, password: string): Promise<void>` — calls
  `POST /api/auth/demo-login`, then refetches the `/api/auth/me` query.
- Extend `AuthUser` type with optional fields:
  ```ts
  impersonating?: boolean;
  realAdmin?: { id: string; displayName: string } | null;
  ```
  (These fields are consumed by ticket 009; adding them here avoids a second AuthContext
  edit later.)

**`client/src/App.tsx`:**
- Add `/` → `<HomePage>` route (replace any existing Home.tsx route at `/`).
- Add or update `/login` → new `Login.tsx` route.
- Remove old `Home.tsx` import if replaced by `HomePage.tsx`.
- Confirm all remaining routes still resolve correctly.

## Acceptance Criteria

- [x] `/login` renders a form with username and password inputs pre-filled with `user`/`pass`
- [x] Submitting `user`/`pass` redirects to `/` and displays two counters
- [x] Submitting `admin`/`admin` redirects to `/` (admin sidebar links appear after 006)
- [x] Submitting bad credentials shows an inline error (no redirect)
- [x] Home page displays `alpha` and `beta` counters with their current values
- [x] Clicking the `alpha` button increments `alpha`; value updates in the UI
- [x] Clicking the `beta` button increments `beta`; value updates in the UI
- [x] Counter values persist across page reload
- [x] `AuthUser` type has `impersonating` and `realAdmin` optional fields
- [x] `loginWithCredentials` helper available on AuthContext
- [x] TypeScript compiles without errors; `npm run test:client` passes

## Implementation Plan

1. Read `client/src/pages/Login.tsx` to understand current content (may already be a stub).
2. Create or replace `Login.tsx` with the credentials form.
3. Create `HomePage.tsx` with React Query counter display and increment buttons.
4. Edit `AuthContext.tsx` — add `loginWithCredentials` and extend `AuthUser` type.
5. Edit `App.tsx` — wire `/` → `HomePage`, `/login` → `Login`.
6. Run `npm run build` (client) to confirm zero TypeScript errors.
7. Manual smoke test: login → counter page → increment.

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write**:
  - Login form renders with pre-filled values
  - Bad credentials shows error message (mock fetch returning 401)
  - Counter page renders counter names and values from mocked API
  - Increment button calls POST and triggers refetch
- **Verification command**: `npm run build && npm run test:client`
