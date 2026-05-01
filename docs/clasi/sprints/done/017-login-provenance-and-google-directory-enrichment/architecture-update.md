---
sprint: "017"
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Architecture Update — Sprint 017: Login Provenance and Google Directory Enrichment

## What Changed

### Schema (Prisma)

| Model | Change |
|---|---|
| `Login` | Add `provider_payload Json?`, `provider_payload_updated_at DateTime?`, `directory_metadata Json?`. |
| `LoginEvent` (new) | `id Int @id`, `login_id Int FK`, `occurred_at DateTime`, `payload Json`, `ip String?`, `user_agent String?`. Cascade-delete with parent `Login`. |

No existing data is touched; all new columns are nullable.

### New Modules

| Module | Purpose |
|---|---|
| `server/src/services/auth/login-payload.ts` | Pure typed accessors over the JSON columns. Reads only. Functions: `getGoogleGroups(login)`, `getGoogleOu(login)`, `getGitHubLogin(login)`, etc. |

### Modified Modules

| Module | Change |
|---|---|
| `server/src/services/auth/sign-in.handler.ts` | After Login upsert, write `provider_payload` (raw OAuth profile), bump `provider_payload_updated_at`, append a `LoginEvent`. New optional `requestContext: { ip?, userAgent? }` argument flows through callsites. The existing Step 4 staff-OU branch additionally calls `listUserGroups`, combines with the OU result, and writes `Login.directory_metadata`. Fail-soft on either Google call. |
| `server/src/services/google-workspace/google-workspace-admin.client.ts` | Add `listUserGroups(email): Promise<{ id, name, email }[]>` (Directory API `groups.list?userKey=`). |
| `server/src/routes/auth.ts` | Each OAuth callback (Google, GitHub, Pike13) and the passphrase/login handlers pass `requestContext: { ip: req.ip, userAgent: req.headers['user-agent'] }` to `signInHandler`. |

## Why

The TODO `plan-single-sign-on-oauth-provider-migration.md` (Sprint 2) calls
for capturing login provenance and Google directory enrichment as a
foundation for sprints 018–019 (OAuth provider work) and ad-hoc admin
needs (which staff are in which Workspace groups, etc.). The data is
cheap to capture at sign-in and prevents a future migration.

## Impact on Existing Components

- All new schema is additive and nullable — existing `Login` rows continue
  to work without backfill. Any code path that reads these fields must
  handle null.
- `signInHandler` signature gains an optional `requestContext` argument;
  existing callers without the argument continue to work (no LoginEvent
  written, payload still written but without IP/UA — acceptable).
- Existing tests are not affected by the schema additions. Tests that
  assert on the absence of `provider_payload` or `LoginEvent` rows will
  need to update.
- `GoogleWorkspaceAdminClientImpl.listUserGroups` is new; existing
  consumers of the admin client are unchanged.
- `login-payload.ts` is new and isolated; no impact unless consumed.

## Migration Concerns

- `prisma db push --accept-data-loss` against dev SQLite. The new columns
  and table are additive; no data loss.
- Production: separate `prisma migrate deploy` step at deploy time. Out
  of scope for this sprint (no production deploy planned).
- Reading code MUST tolerate null `provider_payload` / `directory_metadata`
  values — login-payload.ts helpers return `null` when absent.
- `LoginEvent` is append-only and grows linearly with sign-ins. Acceptable
  for this app's scale (low traffic). Add a retention policy later if it
  becomes an issue.

## Risks

- A bug in the directory-enrichment fail-soft logic could silently block
  staff sign-ins. The integration test for "sign-in succeeds when
  listUserGroups throws" gates this — the implementer must include it.
- A misconfigured Google admin client (missing `groups.list` scope on the
  service account) will cause every staff sign-in to log a warning. Same
  fail-soft behavior; logged not crashed.
- IP capture via `req.ip` depends on `trust proxy` Express config. Already
  set in this app per existing codebase. No new requirement.
