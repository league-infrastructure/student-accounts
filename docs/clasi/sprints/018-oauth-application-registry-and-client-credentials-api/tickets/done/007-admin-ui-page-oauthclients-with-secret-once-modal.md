---
id: '007'
title: Admin UI page OAuthClients with secret-once modal
status: done
use-cases:
- SUC-018-001
- SUC-018-004
depends-on:
- '006'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Admin UI page OAuthClients with secret-once modal

## Description

Add the admin UI for managing OAuth clients. Per
`architecture-update.md` "New Modules (Client)" the page lives at
`client/src/pages/admin/OAuthClients.tsx` and uses the React Query
patterns already established for other admin pages — look at the
existing admin user/cohort pages for the data-fetching, mutation, and
toast/error conventions.

Page layout:

- Header with a "New OAuth Client" button.
- Table listing clients (name, client_id, description, scopes,
  redirect URIs, status pill from `disabled_at`, created_at). Per-row
  actions: Rotate, Disable.
- "New OAuth Client" button opens a form modal (name, description,
  redirect URIs, allowed scopes). Submit calls `POST
  /api/admin/oauth-clients`.
- After a successful create OR rotate, open a SEPARATE modal that
  displays the plaintext `client_secret` with a Copy button and a
  prominent "you will not see this again" warning. Reuse the existing
  LlmProxyToken plaintext-once modal if one already exists in
  `client/src/components/`; otherwise extract a small
  `SecretShownOnceModal.tsx` so sprint 019 can reuse it.
- Disable action confirms, then calls `DELETE
  /api/admin/oauth-clients/:id`. List refreshes via React Query
  invalidation.

Routing + discoverability:

- Add the route `/admin/oauth-clients` in `client/src/App.tsx` (admin-only guard, matching how `/admin/users` is wired).
- Add a tile in `server/src/services/app-tiles.service.ts` with
  `id: 'oauth-clients'`, admin-only, `href: '/admin/oauth-clients'`,
  so the page is reachable from the `/account` dashboard.

## Acceptance Criteria

- [x] `client/src/pages/admin/OAuthClients.tsx` exists and renders the list/create/rotate/disable flow.
- [x] Route `/admin/oauth-clients` registered in `client/src/App.tsx`, admin-guarded.
- [x] Admin tile `oauth-clients` registered in `server/src/services/app-tiles.service.ts` (admin-only).
- [x] Plaintext secret is shown via a one-time modal with Copy button after create AND after rotate.
- [x] List refreshes after each mutation (React Query invalidation).
- [x] Non-admin users do not see the tile and are redirected away from the route.
- [x] No plaintext secret is logged, retained in component state beyond the modal, or reachable via list refetch.

## Testing

- **Existing tests to run**: `npm run test:server` and `npm run test:client`
- **New tests to write**:
  - `client/src/pages/admin/OAuthClients.test.tsx` — create-flow happy path (form submit → secret modal opens with plaintext → list shows new row after dismissal); rotate-flow (action → secret modal opens with new plaintext → list still has the row); disable-flow (confirm → row reflects disabled status).
  - Optional: a small test for the extracted `SecretShownOnceModal` covering the Copy button.
- **Verification command**: `npm run test:server && npm run test:client`
