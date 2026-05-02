---
sprint: "020"
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Architecture Update — Sprint 020: Account Redesign Sidebar Apps and OAuth Clients Democratization

## What Changed

### Schema (Prisma)

No changes. `OAuthClient.created_by` already exists (Sprint 018) and is
the ownership column we filter on.

### Removed Modules (Server)

| Module | Reason |
|---|---|
| `server/src/routes/account-apps.ts` | Sprint 016 endpoint — replaced by sidebar role gating; no longer needed. |
| `server/src/services/app-tiles.service.ts` | Pure tile-computation service — unused after route deletion. |
| `tests/server/routes/account-apps.test.ts` | Tests for the removed route. |
| `tests/server/services/app-tiles.service.test.ts` | Tests for the removed service. |

### Renamed Modules (Server)

| From | To | Reason |
|---|---|---|
| `server/src/routes/admin/oauth-clients.ts` | `server/src/routes/oauth-clients.ts` | Promote out of `/admin` namespace. Mounted at `/api/oauth-clients` under `requireAuth` only. |
| `tests/server/routes/admin/oauth-clients.test.ts` | `tests/server/routes/oauth-clients.test.ts` | Tracks the route move and adds ownership-filter tests. |

### Modified Modules (Server)

| Module | Change |
|---|---|
| `server/src/services/oauth/oauth-client.service.ts` | All public methods accept `actorRole` alongside `actorUserId`. `list({ actorUserId, actorRole })` returns all clients when `actorRole === 'admin'` else filters by `created_by`. `update`, `disable`, `rotateSecret`, `findById` enforce admin-or-owner; throw a typed `ForbiddenError` (or 403 in route layer) on mismatch. |
| `server/src/app.ts` | Mount `oauthClientsRouter` at `/api/oauth-clients` (auth-only). Add a thin compat redirect router at `/api/admin/oauth-clients` that 308-redirects to `/api/oauth-clients` for matching subpaths. Remove the `/api/account/apps` mount. |
| `server/src/routes/account.ts` | New `PATCH /api/account/credentials` route. Body: `{ username?, currentPassword, newPassword? }`. Calls `userService.updateCredentials(actorUserId, patch)`. Reuses the existing scrypt verify/hash helpers from `server/src/services/auth/passphrase-signup.handler.ts` (or wherever password helpers currently live; preserve a single source of truth). |
| `server/src/services/user.service.ts` | New `updateCredentials(userId, { username?, currentPassword, newPassword? })` method. Verifies `currentPassword` against the stored hash; updates `username` (with unique constraint) and/or `password_hash`. 401 / 409 / 400 errors as typed errors. |

### Removed Modules (Client)

| Module | Reason |
|---|---|
| `client/src/components/AppTile.tsx` | No longer used. |
| `tests/client/components/AppTile.test.tsx` (or wherever housed) | Tests for the removed component. |

### Renamed / Moved Modules (Client)

| From | To | Reason |
|---|---|---|
| `client/src/pages/admin/OAuthClients.tsx` | `client/src/pages/OAuthClients.tsx` | Out of `AdminLayout`; rendered under standard `AppLayout`. |

### Modified Modules (Client)

| Module | Change |
|---|---|
| `client/src/pages/Account.tsx` | Strip AppsZone, ServicesSection, ClaudeCodeSection, AccountLlmProxyCard. Add `UsernamePasswordSection` (visible iff `user.username` or `user.password_hash` set). Add Pike 13 Add-Login button (third sibling of the existing two). |
| `client/src/pages/Services.tsx` (NEW) | Consolidates the displaced UIs into one page mounted at `/services`. Conditional sections; friendly empty state. |
| `client/src/pages/OAuthClients.tsx` (moved) | API base updates from `/api/admin/oauth-clients` to `/api/oauth-clients`. Scope input becomes a checkbox group (`profile`, `users:read`). Page itself otherwise unchanged. |
| `client/src/components/AppLayout.tsx` | Sidebar nav populated for all roles. New helper `hasStaffAccess(role)` (added to `client/src/lib/roles.ts`). Drop the `!isAdminSection` gate that hid User Management / Cohorts / Groups / Staff Directory from the standalone sidebar. |
| `client/src/App.tsx` | Add `/services` and `/oauth-clients` routes (under `AppLayout`). Add a redirect from `/admin/oauth-clients` to `/oauth-clients`. Remove all references to AppTile / AppsZone. |

### New Tests

| File | Coverage |
|---|---|
| `tests/server/routes/oauth-clients.test.ts` | List filtering by role, ownership-gated mutations, compat redirect. |
| `tests/server/routes/account-credentials.test.ts` (or co-located in `account.test.ts`) | PATCH /credentials happy path, wrong current password (401), username conflict (409), invalid input (400). |
| `tests/client/pages/Services.test.tsx` | All sections render given different role/entitlement permutations; empty state. |
| `tests/client/AppLayout.test.tsx` (extend existing) | Sidebar items per role; OAuth Clients always visible. |
| `tests/client/OAuthClients.test.tsx` (extend) | Scope checkboxes render and submit correct payload. |

## Why

Stakeholder feedback after Sprint 016: the universal Account page
launchpad model isn't right. Identity belongs on Account; sub-apps belong
in the sidebar. OAuth Clients should be a self-service capability for
every user, not gated to admins.

## Impact on Existing Components

- Any client code referencing `AppTile`, `AppsZone`, or `/api/account/apps`
  must be updated. Today the only callers are inside `Account.tsx` (which
  is being rewritten in this sprint).
- The OAuth Clients API path changes; the compat redirect covers in-flight
  bookmarks but the client must be updated to use the new path.
- `AdminLayout` is still used for genuinely admin-only pages
  (cohorts, groups, dashboard, env, etc.); the OAuth Clients page no
  longer lives under it.

## Migration Concerns

- `prisma db push` is NOT required (no schema changes).
- No data migration. Existing OAuth clients keep their `created_by`
  values; ownership filtering Just Works.
- The compatibility redirect ensures backward compatibility with any
  existing curl scripts pointing at `/api/admin/oauth-clients`. Drop the
  redirect in a future release once the ecosystem migrates.

## Risks

- **Privilege escalation via OAuth client scopes** — a non-admin user can
  register a client with `users:read` scope and read all users via the
  directory API. Documented as a follow-up TODO. Stakeholder explicitly
  deferred scope ceilings.
- **Compat redirect correctness** — the 308 redirect must preserve method
  and body. Test explicitly with both GET and POST.
- **Username uniqueness race** — two simultaneous PATCH credentials
  requests trying to claim the same username could both succeed in a
  pure read-then-write check. Use Prisma's unique-constraint violation
  as the authority and translate to a 409.
