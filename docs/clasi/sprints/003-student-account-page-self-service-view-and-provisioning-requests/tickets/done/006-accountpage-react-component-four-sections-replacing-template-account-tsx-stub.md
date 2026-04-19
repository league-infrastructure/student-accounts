---
id: '006'
title: "AccountPage React component \u2014 four sections replacing template Account.tsx\
  \ stub"
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
depends-on:
- '002'
- '003'
- '004'
- '005'
github-issue: ''
todo: ''
---

# AccountPage React component — four sections replacing template Account.tsx stub

## Description

Replace `client/src/pages/Account.tsx` (currently a template demo page that
uses a different auth model) with a real student account page driven by the
`GET /api/account` aggregate endpoint built in T002–T005.

The page has four sections:
- **Profile** — display name, primary email, cohort.
- **Logins** — connected providers with Add and Remove buttons.
- **Services** — external accounts and provisioning requests with Request buttons.
- **Help** — contact/assistance link.

This ticket includes the staff redirect (if role=staff, redirect to /staff).

## Acceptance Criteria

- [x] AccountPage fetches data from `GET /api/account` using React Query
      (`useQuery`).
- [x] Loading state: skeleton or spinner shown while data is loading.
- [x] Error state: retry button shown with error message on fetch failure.
- [x] Profile section shows: display name, primary email, cohort name (or
      "No cohort assigned" when null).
- [x] Logins section lists all connected providers (Google, GitHub).
- [x] Logins section shows "Add Google" link (`/api/auth/google?link=1`)
      when Google is not linked and Google OAuth is configured.
- [x] Logins section shows "Add GitHub" link (`/api/auth/github?link=1`)
      when GitHub is not linked and GitHub OAuth is configured.
- [x] "Add" buttons are hidden when the provider is not configured
      (uses `useProviderStatus` to gate display).
- [x] "Remove" button is disabled when only one Login is linked.
- [x] Clicking "Remove" calls `DELETE /api/account/logins/:id`; on success,
      invalidates the `['account']` query and re-fetches.
- [x] Remove mutation shows an inline error when the API returns 409.
- [x] Services section shows a row for League Email, Claude Seat, and
      Pike13 with their current status derived from externalAccounts and
      provisioningRequests.
- [x] League Email row shows "Request" button when no active/pending workspace
      account or workspace request exists.
- [x] Claude Seat row shows "Request" button only when the League email
      constraint is met (pending or active workspace account or workspace
      request exists); otherwise the option is disabled with explanatory text.
- [x] Clicking "Request League Email" POSTs `{ requestType: "workspace" }` to
      `/api/account/provisioning-requests`; on success, re-fetches account data.
- [x] Clicking "Request Email + Claude Seat" POSTs
      `{ requestType: "workspace_and_claude" }`; on success, re-fetches.
- [x] Request mutation shows an inline error on API failure.
- [x] Help section shows a contact link (mailto: or equivalent).
- [x] If `user.role === 'staff'`, the page renders `<Navigate to="/staff" replace />`
      immediately without fetching account data.
- [x] Existing `App.tsx` routing is unchanged; `/account` continues to point
      to this component.

## Implementation Plan

### Approach

Rewrite `client/src/pages/Account.tsx` wholesale. Keep the file at the same
path so `App.tsx` import requires no change.

Use `useQuery(['account'], () => fetch('/api/account').then(r => r.json()))`
for the main data. Use `useMutation` from React Query (or manual invalidation
via `queryClient.invalidateQueries`) for Remove Login and Request buttons.

The existing `useProviderStatus` hook is still used to determine which Add
buttons to display.

Extract four sub-components:

- `ProfileSection` — reads `account.profile`
- `LoginsSection` — reads `account.logins`, handles Add/Remove
- `ServicesSection` — reads `account.externalAccounts` and
  `account.provisioningRequests`, handles Request buttons
- `HelpSection` — static or configurable contact link

Keep all inline styles consistent with the existing codebase style (no
Tailwind, inline `React.CSSProperties` objects matching the existing `styles`
pattern in Account.tsx).

### Files to Modify

- `client/src/pages/Account.tsx` — full replacement

### Files to Create

None required; sub-components can live in Account.tsx as named exports
or in `client/src/components/account/` if the file grows unwieldy.

### Testing Plan

Frontend component tests in `tests/client/pages/Account.test.tsx`:

1. Renders loading skeleton while query is pending.
2. Renders profile, logins, services, help sections when data loads.
3. Shows "No cohort assigned" when cohort is null.
4. Add Google link rendered when Google configured and not linked.
5. Add GitHub link rendered when GitHub configured and not linked.
6. Add buttons absent when provider is not configured.
7. Remove button disabled when only one Login remains.
8. Remove Login — success: mutation called, re-fetch triggered.
9. Remove Login — 409 error shown inline.
10. Request League Email — success: POST called, re-fetch triggered.
11. Request Email + Claude — shown only when workspace constraint met.
12. Request Email + Claude — hidden/disabled when constraint not met.
13. Staff role → Navigate to /staff rendered.
14. Error state → retry button shown.

Mock `GET /api/account`, `DELETE /api/account/logins/:id`, and
`POST /api/account/provisioning-requests` with MSW or vitest fetch mocks.
Mock `GET /api/integrations/status` for provider status.

### Documentation Updates

Add `/account` to the route table in the Sprint 003 architecture-update.md
under the AccountPage section (already documented; just ensure implementation
matches).
