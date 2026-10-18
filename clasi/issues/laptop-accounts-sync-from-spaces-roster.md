---
status: pending
---

# Laptop accounts as a provider: import the fleet roster from Spaces

## Context

The League's Ubuntu laptops (repo `ubuntu-install`) have their own student
accounts: a roster of self-chosen usernames in the DigitalOcean Spaces bucket
`jtl-student-unix-accounts`, one object per student,
`students/<id>/config.json`:

```json
{"id": "alice", "display_name": "Alice", "password_hash": "$6$...sha512-crypt...",
 "created": "20260825T170542Z", "created_host": "jtl-inspiron-ABC123"}
```

Next to it live `students/<id>/drive/` (synced work), `journal/`, `cold/`.
The laptops' PAM hook (`league-helper login`) verifies the password against
`password_hash` and materialises a local Unix account on first login.
Ids match `[a-z0-9][a-z0-9-]{2,31}`; reserved names are `student, root,
ansible, ubuntu, admin, adm, daemon, nobody, gdm, sync, bin, sys`.

student-accounts knows nothing about these accounts. Decision (2026-10-17):
student-accounts becomes the one place students have an account, the laptop
roster becomes one more **provider** it knows about (alongside Google,
GitHub, Pike13, username), and existing laptop accounts are imported so they
can be merged with the users already here and get the same LLM proxy token
as everyone else.

This issue is the **import** direction. Writing the roster from here (account
creation, password changes) is `laptop-account-management-in-student-accounts.md`.

## Scope

- A `LaptopRosterClient` that lists and reads `students/*/config.json` from
  Spaces (reuse the S3 client pattern in `backup.service.ts`; pull
  `buildS3Client()` into a shared module and register `DO_SPACES_*` plus the
  new `LAPTOP_ROSTER_BUCKET` in `CONFIG_KEYS`).
- A `LaptopSyncService` modelled on `pike13-sync.service.ts`
  (constructor-injected client, repos, audit, `mergeScan`), with a
  `SyncReport {created, matched, updated, skipped, errors}`.
- A scheduled job (`laptop-sync`, see `scheduler.service.ts` `seedDefaults`
  and `jobs/workspace-delete.job.ts` for the factory pattern) and a manual
  trigger `POST /api/admin/sync/laptop` next to the Pike13/Workspace ones in
  `routes/admin/sync.ts`.
- Admin UI: the laptop login shows up as a provider icon in
  `AdminUsersPanel.tsx` and as a "Laptop account" card in
  `UserDetailPanel.tsx` (id, created, created_host, last synced, hash
  present/locked).

## Design

**Representation.** One `Login` row per roster entry: `provider: 'laptop'`,
`provider_user_id: <id>`, `provider_username: <id>`, `provider_payload`:
the config.json minus `password_hash`, `provider_payload_updated_at`.
`Login.provider` is a free string, so no schema change for that. Add
`laptop_sync` to the `CreatedVia` enum.

**Matching order** for each roster entry (first hit wins, nothing else is
touched on a match):

1. `Login (provider='laptop', provider_user_id=<id>)` → `matched`.
2. `User.username = <id>` → attach a laptop Login to that user, `updated`.
   This is the common case once account creation moves here.
3. Otherwise create: `User {display_name, username: <id>, password_hash:
   <the $6$ hash as-is>, role: student, created_via: laptop_sync,
   approval_status: approved, primary_email: <synthesised, see below>}` +
   the laptop Login + `create_user` audit event, in one transaction; then
   `mergeScan(newUser)` outside it (non-fatal), as Pike13 sync does.

**Password hash.** The roster hash is SHA-512 crypt; `utils/password.ts`
only knows `salt:key` scrypt. Store the crypt hash in `password_hash`
unchanged and teach `verifyPassword` to dispatch on prefix: `$6$` → a
sha512-crypt verifier (add a small dependency, e.g. `sha512crypt-node` /
`unixcrypt`, or implement the ~80-line algorithm with `node:crypto`; must
be constant-time compare). On a successful login with a `$6$` hash, rehash
to scrypt (the write-back issue then re-derives a fresh crypt hash for the
roster). Hashes `!`, `*` or empty never verify, same as the laptops.

**Synthesised email.** `User.primary_email` is required and unique. Laptop
accounts have none. Use `<id>@laptop.invalid` (RFC 2606 TLD, can never be
delivered) and treat `*.invalid` as "no email" in the UI and in
`mail.service.ts` (skip, log). Open to a better convention; the sprint
planner should confirm with the stakeholder. `notification_email` stays
null.

**Deactivation.** A roster entry whose `password_hash` is `!` (locked) or
that disappears from the bucket does **not** deactivate the user here
(student-accounts is becoming the source of truth, and the bucket also
holds their files). Record it on the Login (`directory_metadata.locked /
missing_since`) and show it in the admin card.

**Idempotency.** Re-running is a no-op for matched entries. Only
`display_name` changes on the roster are copied to users whose
`created_via = laptop_sync` and who have no other login.

**Ordering with the write-back issue.** Until account creation moves off
the laptops, new roster entries keep appearing from laptops; this sync
imports them. After the cutover, the sync is still the reconciliation path
(a roster entry with no Login here is a bug worth seeing in the report).

## Files

- `server/src/services/spaces/s3-client.ts` (new; extracted from
  `backup.service.ts`), `server/src/services/laptop/laptop-roster.client.ts`
  (new), `server/src/services/laptop/laptop-sync.service.ts` (new),
  `server/src/jobs/laptop-sync.job.ts` (new)
- `server/src/services/config.ts` (`CONFIG_KEYS`: `DO_SPACES_*`,
  `LAPTOP_ROSTER_BUCKET` default `jtl-student-unix-accounts`,
  `LAPTOP_SYNC_ENABLED`), `server/src/services/service.registry.ts`,
  `server/src/index.ts` (register handler), `server/src/services/scheduler.service.ts`
  (`seedDefaults`: `laptop-sync`, hourly)
- `server/prisma/schema.prisma` (+ migration): `CreatedVia.laptop_sync`
- `server/src/utils/password.ts`: `$6$` verifier + rehash hook in
  `routes/auth/login.ts`
- `server/src/routes/admin/sync.ts`, `client/src/pages/admin/AdminUsersPanel.tsx`
  (provider icon + filter), `client/src/pages/admin/UserDetailPanel.tsx`
  (Laptop account card), `client/src/pages/Account.tsx` (`PROVIDER_LABELS.laptop`)
- Tests: `tests/server/services/laptop-sync.service.test.ts` with a fake
  roster client (pattern: `tests/server/helpers/fake-pike13-api.client.ts`);
  `tests/server/utils/password.test.ts` for `$6$` verification against a
  hash made by `openssl passwd -6`.

## Verification

1. Unit: fake roster with three entries → first run `created: 3`; second run
   `matched: 3`; an entry whose id equals an existing user's `username` →
   `updated` and that user gains a laptop Login, no new user.
2. `verifyPassword('secret', '$6$...')` true for a hash from `openssl passwd
   -6 secret`; false for `!`, `*`, wrong password; scrypt hashes still work.
3. Admin: trigger `POST /api/admin/sync/laptop`, see the report; the user
   list shows the laptop icon; the detail panel shows the card.
4. Sign in at `/api/auth/login` as an imported user with their laptop
   password → 200; their `password_hash` is now scrypt.
5. Scheduler panel lists `laptop-sync`, run-now works, `lastError` empty.

## Dependencies

- Needs a Spaces key with read access to `jtl-student-unix-accounts` in
  prod secrets (the backup key may already cover it if the bucket is the
  same; check `DO_SPACES_BUCKET=league-student-storage` in
  `config/prod/public.env` against the roster bucket name).
