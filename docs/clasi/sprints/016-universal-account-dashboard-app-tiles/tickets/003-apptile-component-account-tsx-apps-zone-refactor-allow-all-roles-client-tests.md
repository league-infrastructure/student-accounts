---
id: "003"
title: "AppTile component + Account.tsx Apps zone refactor (allow all roles) + client tests"
status: todo
use-cases: [SUC-016-002, SUC-016-003]
depends-on: ["001"]
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# AppTile component + Account.tsx Apps zone refactor (allow all roles) + client tests

## Description

Wire up the client side of the universal dashboard.

**New file:** `client/src/components/AppTile.tsx`

A presentational component. Props:
```ts
{ id: string; title: string; description: string; href: string; icon: string }
```

Renders a clickable card that navigates to `href`. The icon prop is a string
key — implementer maps the small set of values used by the server tile
catalog (`users`, `directory`, `bot`, `cohort`, `group`) to whatever icon
source the project uses (emoji, lucide-react, or inline SVG). If the icon
key is unknown, render a sensible fallback.

**Modified file:** `client/src/pages/Account.tsx`

1. **Remove** the `<Navigate to="/" replace />` early return for
   `role === 'admin'` (around line 525). All roles should render the page.
2. **Lift** the `enabled` guard on the existing student-account React Query
   so non-students don't run the student-only `/api/account` query (which
   has `requireRole('student')` and would 403). For non-students, skip the
   Profile/Identity zone or render a minimal stub.
3. **Add** an Apps zone (new section in the page) that calls
   `GET /api/account/apps` via React Query. Render the returned tiles in
   a responsive grid using `<AppTile>`. Show a skeleton while loading.
   Show a friendly empty state if the user has no tiles (shouldn't happen
   in practice, but cover it).
4. The existing student-only sections (Profile, Sign-in Methods, Services,
   Claude Code, LLM Proxy card) should continue to render for students,
   in their existing layout, above the Apps zone.

**Test file:** `tests/client/pages/Account.test.tsx` (or add to whichever
test file covers Account.tsx today; check first).

Add tests:
- Admin user: page renders without redirecting away. Apps zone shows tiles
  fetched from a mocked `/api/account/apps`. Profile/Identity zone is
  hidden or shows the minimal stub (no `/api/account` call).
- Staff user: same — page renders, Apps zone shows tiles.
- Student user: page renders all existing sections AND the Apps zone.
- Tiles appear and clicking one navigates (use `MemoryRouter`).

## Acceptance Criteria

- [ ] `client/src/components/AppTile.tsx` exists and renders the documented props.
- [ ] `Account.tsx` no longer redirects admins away.
- [ ] `Account.tsx` calls `/api/account/apps` for all authenticated users.
- [ ] `Account.tsx` does NOT call `/api/account` for non-students (avoid 403 noise).
- [ ] Existing student sections still render for students, unchanged in appearance.
- [ ] New tests cover student/staff/admin views.
- [ ] Client typecheck passes (no new TS errors beyond the pre-existing 4).
- [ ] Client test suite same baseline (no new failures).

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write**: see Description.
- **Verification command**: `npm run test:client && cd client && npx tsc --noEmit -p tsconfig.app.json`
