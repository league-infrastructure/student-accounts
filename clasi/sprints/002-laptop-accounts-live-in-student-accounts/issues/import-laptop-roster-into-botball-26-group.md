---
status: in-progress
sprint: '002'
tickets:
- 002-001
- 002-002
- 002-003
---

# One-time import of the laptop roster into student-accounts (group "Botball 26")

## Context

The League's Ubuntu laptops (repo `ubuntu-install`) have had their own
student accounts: a roster in the DigitalOcean Spaces bucket
`jtl-student-unix-accounts`, one object per student,
`students/<id>/config.json`:

```json
{"id": "alice", "display_name": "Alice", "password_hash": "$6$...sha512-crypt...",
 "created": "20260825T170542Z", "created_host": "jtl-inspiron-ABC123"}
```

Next to it: `students/<id>/drive/` (synced work), `journal/`, `cold/`.
The laptops' PAM hook (`league-helper login`) checks the password against
`password_hash` (glibc SHA-512 crypt) and materialises a local Unix
account. Ids match `[a-z0-9][a-z0-9-]{2,31}`; reserved names are
`student root ansible ubuntu admin adm daemon nobody gdm sync bin sys`.

Decision (2026-10-17): student-accounts is the one place students have an
account. A laptop account is **not a provider**; it is just the username
and password every user here can already have. The existing laptop
accounts are brought in with a **one-time import** into the group
**"Botball 26"**, after which student-accounts pushes credentials back out
to the roster (`laptop-account-management-in-student-accounts.md`) and the
laptop app stops creating accounts.

## Scope

- An importer that reads every `students/*/config.json` from the roster
  bucket and creates (or attaches to) users here.
- Run it as an admin action (button + endpoint) and as a one-shot script;
  re-running is safe and reports what it did.
- The SHA-512 crypt verifier so imported students can sign in here with
  the password they already use on the laptops.
- A small shared Spaces client (the write-back issue needs it too).

## Design

**Spaces client.** Extract `buildS3Client()` from `backup.service.ts`
into `server/src/services/spaces/s3-client.ts`; add a
`LaptopRosterClient` (`listIds()`, `read(id)`, `write(id, entry)`) over
`@aws-sdk/client-s3`, constructor-injected for tests like the backup
service's `opts.s3Client`. Register `DO_SPACES_*` and
`LAPTOP_ROSTER_BUCKET` (default `jtl-student-unix-accounts`) in
`CONFIG_KEYS`.

**Per roster entry**, in `LaptopRosterImportService.importAll(actorId)`:

1. Skip reserved or malformed ids (`skipped`, with reason).
2. `User.username == id` exists → `matched` (nothing changed; record in
   the report whether that user already has a laptop-compatible hash).
3. Otherwise create, in one transaction (pattern: `pike13-sync.service.ts`):
   - `User {username: id, display_name, password_hash: <the $6$ hash
     as-is>, laptop_password_hash: <same>, role: student,
     created_via: laptop_import, approval_status: approved,
     primary_email: "<id>@laptop.invalid"}`
   - a `Login {provider: 'username', provider_user_id: "laptop-import:<id>",
     provider_username: id, provider_payload: {created, created_host}}`,
     the same representation `passphrase-signup.handler.ts:154` uses for
     username/password users, so nothing downstream needs a new provider.
   - `UserGroup` membership in group **"Botball 26"** (create the group if
     missing; make the name a parameter of the importer, default from the
     admin form).
   - `create_user` audit event with `source: laptop_import`.
   Then `mergeScan(newUser)` outside the transaction (non-fatal), so the
   merge queue fills with likely duplicates of Google/GitHub users.
4. Report `{created, matched, skipped, errors, errorDetails}`, returned to
   the admin UI and logged.

**Password hashes.** `utils/password.ts` only knows `salt:key` scrypt.
Add a SHA-512 crypt verifier (small dependency such as `unixcrypt`, or the
algorithm in `node:crypto`; constant-time compare) and dispatch on the
`$6$` prefix in `verifyPassword`. `!`, `*` and empty never verify. On a
successful sign-in with a `$6$` `password_hash`, rehash to scrypt; keep
the crypt hash in the new column `User.laptop_password_hash` (the
write-back issue maintains that column going forward).

**Synthesised email.** `primary_email` is required and unique; imported
accounts have none. Use `<id>@laptop.invalid` (RFC 2606 TLD, undeliverable
by construction). `mail.service.ts` must refuse to send to `*.invalid`
(log and skip), and the UI shows "no email on file" for it. When the
student later links Google/GitHub or an admin sets a real email, the
placeholder is replaced (sign-in handler already attaches by email; the
admin email form from the credentials issue sets `primary_email`).

**Not a provider.** No new `Login.provider` value, no scheduled sync, no
deactivation on roster changes. After the import, the roster is written by
this app, not read.

**Admin surface.** `POST /api/admin/import/laptop-roster` body
`{groupName}` (admin only) returns the report; a button "Import laptop
roster…" on the admin Groups or Users page with the group name prefilled
"Botball 26" and a confirm. Also `npm run import:laptop-roster -- --group
"Botball 26"` for running from a shell inside the container. Idempotent:
a second run reports everything as `matched`.

## Files

- `server/src/services/spaces/s3-client.ts` (new, extracted),
  `server/src/services/laptop/laptop-roster.client.ts` (new),
  `server/src/services/laptop/laptop-roster-import.service.ts` (new),
  `server/src/scripts/import-laptop-roster.ts` (new; wire `npm run`)
- `server/prisma/schema.prisma` + migration: `CreatedVia.laptop_import`,
  `User.laptop_password_hash String?`
- `server/src/utils/password.ts` (`$6$` verifier + `isCryptHash`),
  `server/src/routes/auth/login.ts` (rehash hook),
  `server/src/services/mail.service.ts` (`.invalid` guard)
- `server/src/services/config.ts` (`CONFIG_KEYS`),
  `server/src/services/service.registry.ts`
- `server/src/routes/admin/import.ts` (new) mounted in `app.ts`;
  client: import button + report dialog (admin Users or Groups panel)
- Tests: `tests/server/services/laptop-roster-import.service.test.ts`
  (fake roster client with three entries, one matching an existing
  username, one reserved); `tests/server/utils/password.test.ts` with a
  hash from `openssl passwd -6 secret`; route test for the admin
  endpoint (403 for students, report shape).

## Verification

1. Fake roster of three → first run `created: 2, matched: 1` (the one
   whose id equals an existing username), group "Botball 26" has the two
   new members; second run `matched: 3`.
2. Imported user signs in at `/api/auth/login` with their laptop password
   → 200; `password_hash` becomes scrypt, `laptop_password_hash` keeps
   the `$6$`.
3. `verifyPassword` false for `!`, `*`, wrong password; scrypt still works.
4. Mail to `x@laptop.invalid` is skipped with a log line, not an error.
5. Admin button runs the import and shows the report; merge queue gains
   suggestions for obvious duplicates.

## Dependencies

- Prod needs a Spaces key that can read the roster bucket (write is
  needed by the write-back issue; one read-write key scoped to that bucket
  serves both). Check `DO_SPACES_BUCKET=league-student-storage` in
  `config/prod/public.env`: the backup bucket is different from the roster
  bucket, so this is a second bucket name, not a second key.
