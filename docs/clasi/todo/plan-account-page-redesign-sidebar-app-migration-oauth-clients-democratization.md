---
status: pending
---

# Plan: Account-page redesign + sidebar app migration + OAuth-Clients democratization

## Context

The four-sprint SSO/OAuth migration just shipped (sprints 016–019). On reviewing the result, the stakeholder doesn't like the new Account page: the AppTile grid is unwanted noise, and the page conflates identity-management with sub-app launchpad and external-service status. The fix:

- **Account page** becomes identity-only — name, optional username/password, linked logins, three Add-Login buttons (Google / GitHub / Pike 13).
- **Sub-apps** (User Management, Staff Directory, Cohorts, Groups, LLM Proxy, OAuth Clients) leave the tile grid and live in the **sidebar** instead, role-gated.
- **OAuth Clients** management is **promoted from admin-only to all-authenticated-users**. Every student, staff, and admin can register their own OAuth clients to integrate third-party tools.
- The displaced **Services / Claude Code / LLM-Proxy** UI consolidates into a single new `/services` sidebar page.

Out of scope: scope ceilings on student-registered OAuth clients (deferred TODO), rate limits on client creation, dropping the `/admin/oauth-clients` route compatibility (we'll redirect it cleanly).

## Server changes

### Delete the AppTile API surface

- Delete `server/src/routes/account-apps.ts`
- Delete `server/src/services/app-tiles.service.ts`
- Delete `tests/server/routes/account-apps.test.ts`
- Delete `tests/server/services/app-tiles.service.test.ts`
- Remove the `/api/account/apps` mount in `server/src/app.ts`

### Move OAuth-Clients API out of `/api/admin`

- Rename `server/src/routes/admin/oauth-clients.ts` → `server/src/routes/oauth-clients.ts`
- Mount under `/api/oauth-clients` in `server/src/app.ts`, behind `requireAuth` only (no `requireRole('admin')`)
- Keep a thin compat redirect at `/api/admin/oauth-clients/*` → `/api/oauth-clients/*` for one release (delete after the client is updated)
- Update `tests/server/routes/admin/oauth-clients.test.ts` → `tests/server/routes/oauth-clients.test.ts` accordingly

### Service-layer ownership filtering

In `server/src/services/oauth/oauth-client.service.ts`:

- `list({ actorUserId, actorRole })` — admin sees all; non-admin sees only `created_by === actorUserId`. The schema already has `created_by` (sprint 018) — no migration needed.
- `update(id, patch, actorUserId, actorRole)` — admin OR `created_by === actorUserId`; throw 403 otherwise
- `disable(id, actorUserId, actorRole)` — same ownership check
- `rotateSecret(id, actorUserId, actorRole)` — same ownership check
- `findById(id, actorUserId, actorRole)` — same; used for `GET /api/oauth-clients/:id`

Audit events (`oauth_client_*`) already record `actor_user_id`. Nothing to add.

### Pike 13 link mode — confirm wiring

Pike 13 link mode is already implemented at `server/src/routes/auth.ts` (sprint 015). No server change required; the Account page just needs the third Add-Login button.

### Tests

- Update existing OAuth-client route tests to cover ownership filtering: a student creates a client, sees only their own in `list`, and gets 403 if they try to mutate another user's client. Admin still sees everything.
- Verify the redirect-compat layer works (1 test).

## Client changes

### Account.tsx — strip down to identity-only

Keep:
- `ProfileSection` (display name + email + role/cohort badges)
- `LoginsSection` — table of linked OAuth identities

Add:
- `UsernamePasswordSection` (NEW) — for users where `User.username` and/or `User.password_hash` are set (passphrase-signup students). Edit username (uniqueness check) and change password. Hidden when both fields are null. Reuse the existing passphrase verify pattern from `server/src/services/auth/sign-in.handler.ts` for password-change validation; gate the API behind `requireAuth`. New endpoint: `PATCH /api/account/credentials` taking `{ username?, currentPassword, newPassword? }`.
- A third Add-Login button: **Add Pike 13** (links to `GET /api/auth/pike13?link=1`). Always-visible buttons per the user's direction; idempotent re-link is a no-op.

Drop:
- `ServicesSection`
- `ClaudeCodeSection`
- `AccountLlmProxyCard`
- `AppsZone`
- All `/api/account/apps` fetch logic
- `client/src/components/AppTile.tsx` (and its tests)

### New sidebar page: `/services`

A new `client/src/pages/Services.tsx` that consolidates the three displaced UIs into a single page:
- External-account status table (League email + temp password, Claude seat, LLM proxy enabled, Pike 13 link) — moved from `Account.tsx` `ServicesSection`
- Claude Code install instructions — moved from `Account.tsx` `ClaudeCodeSection`
- LLM Proxy management — moved from `AccountLlmProxyCard` (rename or rehouse the component)

Conditional rendering by role and entitlements (a staff user without an LLM proxy token sees only the parts that apply). The page is reachable from the sidebar by all authenticated users; if nothing applies, render a friendly empty state.

Move the file: `client/src/pages/account/AccountLlmProxyCard.tsx` → `client/src/pages/services/ServicesLlmProxyCard.tsx` (or just import from its current path; we don't need to rename to ship).

### Sidebar (`client/src/components/AppLayout.tsx`) — populate role-gated app menu

Today `MAIN_NAV` is empty for non-admin users and `ADMIN_WORKFLOW_NAV` covers admin items. Reshape the menu data so every authenticated user sees the apps they're entitled to:

```
- Account              (always)        → /account
- Services             (always)        → /services
- OAuth Clients        (always)        → /oauth-clients
- LLM Proxy            (students)      → /services#llm-proxy   (anchor to the Services section, OR a child route)
- Staff Directory      (staff, admin)  → /staff/directory
- User Management      (staff, admin)  → /admin/users
- Cohorts              (admin)         → /admin/cohorts
- Groups               (admin)         → /admin/groups
```

The role-gating helper (`hasAdminAccess(role)` from `client/src/lib/roles.ts`) already exists; reuse it. Add a `hasStaffAccess(role)` helper or inline the equivalent. The sidebar render code stays JSX-based — no need to invent a config-driven menu yet.

Note that **User Management, Cohorts, Groups, Staff Directory** are already in `ADMIN_WORKFLOW_NAV`. The change is to also surface them when NOT in `/admin/*` (today they only appear when the admin opens the workflow shell). Drop the `!isAdminSection` gate for these so they show in the standalone sidebar everywhere.

### OAuth Clients page — promote out of `/admin`

- Move `client/src/pages/admin/OAuthClients.tsx` → `client/src/pages/OAuthClients.tsx`
- Update `client/src/App.tsx`: change route from `/admin/oauth-clients` (under `<AdminLayout>`) to `/oauth-clients` (under the regular `<AppLayout>`). Add a redirect from `/admin/oauth-clients` → `/oauth-clients` for in-flight bookmarks.
- Update the page's API base from `/api/admin/oauth-clients` to `/api/oauth-clients`
- **Replace the free-text scope input with a checkbox group.** Scopes are a fixed small set: `profile` (for `/oauth/userinfo`) and `users:read` (for `/v1/users`). Render two checkboxes; default both unchecked. Same for the redirect-URIs editor — keep multi-line text input (those *are* free-form).

A non-admin user only sees their own clients (server filters); the UI doesn't need a per-role branch beyond what already exists.

### Tests

- Delete `tests/client/components/AppTile.test.tsx` (or wherever)
- Update `tests/client/pages/Account.test.tsx`: drop AppsZone assertions, add UsernamePasswordSection tests, add Pike 13 button assertion.
- New: `tests/client/pages/Services.test.tsx` — covers the consolidated Services page
- Update `tests/client/OAuthClients.test.tsx` for the new path + scope checkboxes
- Sidebar tests (`tests/client/AppLayout.test.tsx`): add the new menu items, verify role gating

## Critical files to modify

Server:
- `server/src/app.ts` — route mount changes
- `server/src/routes/oauth-clients.ts` (renamed from admin/oauth-clients.ts)
- `server/src/services/oauth/oauth-client.service.ts` — ownership filtering
- `server/src/routes/account.ts` — new `PATCH /api/account/credentials`
- `server/src/services/user.service.ts` — `updateCredentials` method (or extend existing patch)

Client:
- `client/src/pages/Account.tsx` — strip + add UsernamePasswordSection + Pike 13 button
- `client/src/pages/Services.tsx` — NEW
- `client/src/pages/OAuthClients.tsx` — moved + scope checkboxes
- `client/src/components/AppLayout.tsx` — sidebar items
- `client/src/App.tsx` — route changes

Files to delete:
- `client/src/components/AppTile.tsx` (+ tests)
- `server/src/routes/account-apps.ts` (+ tests)
- `server/src/services/app-tiles.service.ts` (+ tests)

## Verification

1. **Server:** `npm run test:server` returns to baseline (~1620 passing modulo the known flake). New ownership-filter tests pass.
2. **Server typecheck:** `npx tsc --noEmit -p server/tsconfig.json` — no new errors beyond the 21 baseline.
3. **Client:** `npm run test:client` baseline holds (~203 passing + 35 pre-existing failures unchanged). New Account / Services / sidebar tests pass.
4. **Client typecheck:** `cd client && npx tsc --noEmit -p tsconfig.app.json` — no new errors beyond the 4 baseline.
5. **Manual smoke (`npm run dev`):**
   - Sign in as a student. `/account` shows only Profile + Linked Logins + Add Google/GitHub/Pike13. Sidebar shows Account, Services, OAuth Clients.
   - Sidebar → Services renders Workspace temp password, Claude Code steps, LLM proxy card (whatever applies).
   - Sidebar → OAuth Clients lets the student create a client. Scope checkboxes show `profile` and `users:read`. Created client appears in the list.
   - Sign in as a different student, confirm they don't see the first student's clients.
   - Sign in as admin, confirm OAuth Clients page lists every user's clients.
   - From a student session, attempt to PATCH/disable/rotate another user's client via curl with the session cookie → 403.
   - Click Add Pike 13 on Account → Pike 13 link flow runs (server already supports it).
6. **Compat redirects:** `curl -i http://localhost:5201/api/admin/oauth-clients` returns a 301 to `/api/oauth-clients`. Visiting `/admin/oauth-clients` in the browser redirects to `/oauth-clients`.

## Sprint sequencing

This is one sprint, ~6–8 tickets:

1. Server: delete app-tiles + account-apps; remove mounts; clean up tests
2. Server: move oauth-clients router out of `/api/admin`; ownership filtering in service layer; redirect compat
3. Server: `PATCH /api/account/credentials` endpoint + tests
4. Client: strip Account.tsx, add UsernamePasswordSection, add Pike 13 button
5. Client: new Services page consolidating moved sections
6. Client: move OAuthClients page out of /admin, swap free-text scopes for checkboxes
7. Client: sidebar menu items + role gating
8. Manual smoke pass

Ticket 1 and 7 can run in parallel with the others where dependencies allow.

## Follow-up TODO (not this sprint)

- Scope ceilings on non-admin OAuth clients (students shouldn't be able to grant `users:read` to a client they own)
- Rate limit on `POST /api/oauth-clients` (e.g., max 10 per user)
- Drop the `/api/admin/oauth-clients` and `/admin/oauth-clients` redirects after one release
