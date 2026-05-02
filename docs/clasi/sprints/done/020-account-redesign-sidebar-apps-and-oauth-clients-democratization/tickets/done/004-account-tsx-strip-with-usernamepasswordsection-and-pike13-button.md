---
id: '004'
title: Account.tsx strip with UsernamePasswordSection and Pike13 button
status: done
use-cases:
- SUC-020-001
depends-on:
- '003'
github-issue: ''
todo: plan-account-page-redesign-sidebar-app-migration-oauth-clients-democratization.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Account.tsx strip with UsernamePasswordSection and Pike13 button

## Description

Reduce `client/src/pages/Account.tsx` to identity management only.
See `architecture-update.md` § "Modified Modules (Client)" and use
case **SUC-020-001**.

**Strip.** Keep `ProfileSection` and `LoginsSection`. Remove
`ServicesSection`, `ClaudeCodeSection`, `AccountLlmProxyCard`. Ticket
001 already removed `AppsZone` and the `/api/account/apps` query, so
those should already be gone — verify. The Services / Claude / LLM
content is moving to `client/src/pages/Services.tsx` (ticket 005);
this ticket only deletes them from Account.

**UsernamePasswordSection.** Add a new section component (in
`client/src/pages/account/UsernamePasswordSection.tsx`, or co-located
in Account.tsx — pick whichever matches the existing section pattern)
that renders **only when** `user.username` is set OR
`user.password_hash` is set (the GET account endpoint already exposes
both — confirm via the existing `useAccount`/`fetchAccount` shape; if
`password_hash` is not exposed, surface a boolean `has_password`
instead and add it server-side as a tiny shim).

The form has:
- editable `username` input,
- `currentPassword` input,
- `newPassword` input,
- `confirmNewPassword` input (client-side equality check before submit).

Submit calls `PATCH /api/account/credentials` (ticket 003). Show
inline errors mapped from 400 / 401 / 409. On 200, refresh the
account query and reset the form. Username uniqueness is **server-
checked** — do not duplicate the check client-side; just surface the
409 response as "Username already taken".

**Pike 13 Add button.** In `LoginsSection`, add a third
"Add Pike 13" button alongside the existing Add Google / Add GitHub
buttons. Target href `/api/auth/pike13?link=1` (the link-mode flow
landed in Sprint 015). Button is always visible regardless of which
providers the user already has linked, matching the stakeholder's
"always-visible Add buttons" decision (sprint.md § Goals).

## Acceptance Criteria

- [x] `Account.tsx` no longer renders `ServicesSection`, `ClaudeCodeSection`, or `AccountLlmProxyCard`; their imports are removed.
- [x] `Account.tsx` continues to render `ProfileSection` and `LoginsSection` unchanged in behaviour.
- [x] `UsernamePasswordSection` renders iff the user has a username or password set; never for users without either.
- [x] Username/password form posts to `PATCH /api/account/credentials` and surfaces 400 / 401 / 409 errors inline.
- [x] `LoginsSection` has three Add buttons (Google, GitHub, Pike 13); the Pike 13 button targets `/api/auth/pike13?link=1`.
- [x] All three Add buttons are always visible regardless of currently-linked providers.
- [x] `npm run test:client` passes (modulo pre-existing baseline).

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write** (extend `tests/client/pages/Account.test.tsx`):
  - Page no longer renders any AppsZone / Services / Claude / LLM proxy markers (negative assertions).
  - All three Add buttons render for a user with no linked logins; same for a user who already has all three linked.
  - Pike 13 button has href `/api/auth/pike13?link=1`.
  - `UsernamePasswordSection` does NOT render for a user with no username and no password.
  - `UsernamePasswordSection` renders for a user with `username` set; renders for a user with password set; renders for both.
  - Submitting with mismatched `newPassword` / `confirmNewPassword` shows a client-side error and does NOT call the API.
  - 409 response surfaces "Username already taken" inline.
  - 401 response surfaces "Current password is incorrect" inline.
- **Verification command**: `npm run test:client -- Account`
