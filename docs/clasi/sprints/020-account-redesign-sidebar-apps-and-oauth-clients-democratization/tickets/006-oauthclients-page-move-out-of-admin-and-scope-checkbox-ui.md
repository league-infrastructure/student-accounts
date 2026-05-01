---
id: "006"
title: "OAuthClients page move out of admin and scope checkbox UI"
status: todo
use-cases:
  - SUC-020-002
  - SUC-020-003
depends-on:
  - "002"
github-issue: ""
todo: "plan-account-page-redesign-sidebar-app-migration-oauth-clients-democratization.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# OAuthClients page move out of admin and scope checkbox UI

## Description

Move the OAuth Clients management page out of the admin namespace and
replace its free-text scope input with a fixed checkbox group. See
`architecture-update.md` §§ "Renamed / Moved Modules (Client)" and
"Modified Modules (Client)" and use cases **SUC-020-002**,
**SUC-020-003**.

**Move the page.** Rename `client/src/pages/admin/OAuthClients.tsx`
→ `client/src/pages/OAuthClients.tsx`. Update the route in
`client/src/App.tsx`: change `/admin/oauth-clients` (currently line
~106) to `/oauth-clients`, and render it under `AppLayout` (NOT
`AdminLayout`). Add a redirect from `/admin/oauth-clients` →
`/oauth-clients` for in-flight bookmarks — use
`<Route path="/admin/oauth-clients" element={<Navigate to="/oauth-clients" replace />} />`
(or whatever pattern the project already uses for redirects;
search for `Navigate replace` first).

**Update the API base.** Inside the page, change every
`/api/admin/oauth-clients[...]` URL to `/api/oauth-clients[...]`.
The compat redirect from ticket 002 covers stale clients, but the
page itself should use the canonical path so it doesn't pay a 308
on every request.

**Scope checkbox UI.** Replace the free-text scope input with a
checkbox group whose options are exactly the two scopes this sprint
supports:

- `profile`
- `users:read`

Render two `<input type="checkbox">` controls (or whatever checkbox
primitive the codebase already uses) with the scope name as the
value. The form's submit payload should send `allowed_scopes` as a
string array of the checked values (matching the field name the
server already accepts). Pre-check selected scopes when editing an
existing client. Changing scopes is admin-only on the **server**
(per ticket 002's ownership check — non-admin owners can update
their own client's name/description/redirect_uris but the
`allowed_scopes` field is gated to admin in the service); reflect
this on the UI by disabling the checkboxes when
`!hasAdminAccess(user.role)` and the user is editing.
**Note:** if the service does NOT today gate `allowed_scopes` to
admin, leave the checkboxes always-editable and add a TODO comment
linking back to sprint.md "Out of Scope: Scope ceilings" — do not
invent server-side gating in this ticket.

## Acceptance Criteria

- [ ] `client/src/pages/OAuthClients.tsx` exists; `client/src/pages/admin/OAuthClients.tsx` is deleted.
- [ ] Route `/oauth-clients` mounted under `AppLayout` in `client/src/App.tsx`.
- [ ] `/admin/oauth-clients` redirects (client-side) to `/oauth-clients`.
- [ ] Page calls `/api/oauth-clients[...]` everywhere — no `/api/admin/oauth-clients` strings remain.
- [ ] Scope input is a checkbox group with exactly two options: `profile`, `users:read`.
- [ ] Submitted payload uses `allowed_scopes: string[]`.
- [ ] Editing an existing client pre-checks the boxes for currently-granted scopes.
- [ ] `npm run test:client` passes (modulo baseline).

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write** (extend `tests/client/OAuthClients.test.tsx`):
  - Renders both `profile` and `users:read` checkboxes.
  - Submitting with both checked sends `allowed_scopes: ['profile', 'users:read']`.
  - Submitting with only `profile` checked sends `allowed_scopes: ['profile']`.
  - Editing an existing client whose current scopes include `users:read` shows that checkbox pre-checked.
  - List request hits `/api/oauth-clients` (assert via fetch mock).
  - Visiting `/admin/oauth-clients` renders the same content as `/oauth-clients` (redirect smoke test).
- **Verification command**: `npm run test:client -- OAuthClients`
