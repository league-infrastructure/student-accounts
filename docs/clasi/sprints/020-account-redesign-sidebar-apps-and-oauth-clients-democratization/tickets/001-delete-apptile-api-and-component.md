---
id: '001'
title: Delete AppTile API and component
status: done
use-cases:
- SUC-020-001
depends-on: []
github-issue: ''
todo: plan-account-page-redesign-sidebar-app-migration-oauth-clients-democratization.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Delete AppTile API and component

## Description

Sprint 016 introduced an AppTile launchpad on `/account` backed by
`GET /api/account/apps`, `app-tiles.service`, and an `AppTile` client
component. Sprint 020 replaces that model with sidebar navigation, so
the entire AppTile surface is being removed. See
`architecture-update.md` §§ "Removed Modules (Server)" and "Removed
Modules (Client)".

Delete the following files outright:

- `server/src/routes/account-apps.ts`
- `server/src/services/app-tiles.service.ts`
- `client/src/components/AppTile.tsx`
- `tests/server/routes/account-apps.test.ts`
- `tests/server/services/app-tiles.service.test.ts`

Then in `server/src/app.ts` remove the `accountAppsRouter` import
(currently line 14) and the corresponding `app.use(...)` mount so no
route serves `/api/account/apps`. In `client/src/pages/Account.tsx`
strip the `AppTile` import (line ~19), the `fetchAccountApps` helper
(~line 95), the `AppsZone` component (~line 497), and the
`<AppsZone />` render (~line 651). The query key `'account-apps'` and
the `fetch('/api/account/apps')` call must both go away.

Ticket 004 continues the Account.tsx rewrite (UsernamePasswordSection,
Pike 13 button, etc.); this ticket only excises AppTile-specific code
so the later tickets start from a clean base. AppLayout is untouched
in this ticket.

Run a final grep across `server/src`, `client/src`, and `tests/` for
`AppTile`, `app-tiles`, `account-apps`, `/account/apps`, and `AppsZone`
to confirm zero remaining references. Also update
`tests/client/pages/Account.test.tsx` to drop the
`'/api/account/apps'` mock branch (line ~138) — leave the rest of that
file alone; ticket 004 owns the deeper rewrite.

## Acceptance Criteria

- [ ] `server/src/routes/account-apps.ts`, `server/src/services/app-tiles.service.ts`, `tests/server/routes/account-apps.test.ts`, and `tests/server/services/app-tiles.service.test.ts` are deleted.
- [ ] `client/src/components/AppTile.tsx` is deleted.
- [ ] `server/src/app.ts` no longer imports or mounts `accountAppsRouter`; no route serves `/api/account/apps`.
- [ ] `client/src/pages/Account.tsx` no longer imports `AppTile`, defines `fetchAccountApps` / `AppsZone`, or renders `<AppsZone />`.
- [ ] `tests/client/pages/Account.test.tsx` no longer mocks `/api/account/apps`.
- [ ] `grep -rn "AppTile\|app-tiles\|account-apps\|/account/apps\|AppsZone" server/src client/src tests` returns nothing.
- [ ] `npm run test:server` and `npm run test:client` pass (modulo pre-existing baselines).

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client`
- **New tests to write**: None — this ticket only deletes code. Verification is grep + green test runs.
- **Verification command**: `npm run test:server && npm run test:client`
