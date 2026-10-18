---
status: in-progress
sprint: '002'
tickets:
- 002-004
- 002-006
---

# Laptop accounts are managed here: push credentials out to the roster

## Context

After the one-time import (`import-laptop-roster-into-botball-26-group.md`)
student-accounts is the source of truth for laptop logins. The laptops keep
reading `students/<id>/config.json` from Spaces at login (unchanged PAM
path), so this app has to **write** that object for every user who should
be able to log in on a laptop: their `username` and a SHA-512 crypt hash of
their password. The laptop app's own account creation, rename and password
change are removed on the `ubuntu-install` side
(`docs/issue-laptop-accounts-move-to-student-accounts.md` there).

## Scope

- Maintain `User.laptop_password_hash` (SHA-512 crypt) whenever a password
  is set or changed here (we hold the plaintext only then).
- Write the roster entry on every relevant change, and offer "push all" for
  the imported cohort and as a repair.
- Username rules compatible with the laptops.
- Lock the entry for deactivated users. Never delete under `students/<id>/`.
- Rename is out of scope for this issue (see Open).

## Design

**Who has a laptop account.** Every user with `username` and
`laptop_password_hash`, `is_active`, and `allows_laptop_account` (new
`Boolean @default(true)`; `allows_league_account` already means a Google
Workspace account, so don't reuse it). Admins can switch it off per user.

**When to write.** `LaptopAccountService.reconcile(userId)` is called
after: password set/changed (`user.service.ts` credentials patch, admin
set-password from the credentials issue, passphrase signup setting
credentials), username set, display-name change, deactivate/reactivate,
flag change, merge approval. It computes the desired entry and writes it
if different from what is in the bucket (read-before-write, so `created`
and `created_host` are preserved):

```json
{"id": "<username>", "display_name": "<display_name>",
 "password_hash": "<laptop_password_hash>", "created": "<kept or now>",
 "created_host": "<kept or 'student-accounts'>",
 "managed_by": "student-accounts", "updated": "<YYYYMMDDTHHMMSSZ>"}
```

Deactivated, flag off, or no password → `"password_hash": "!"` (locked;
`league-helper` rejects it) rather than deleting, because `drive/` next to
it is the student's work.

**Crypt hash.** Computed at set time with the same SHA-512 crypt
implementation the import issue adds (`makeCryptHash(plaintext)`,
`rounds` default). Stored in `User.laptop_password_hash`; `password_hash`
stays scrypt. Users who only have a passphrase have no laptop account
until they set a password.

**Username rules.** With `allows_laptop_account` on, a username must match
`[a-z0-9][a-z0-9-]{2,31}` and not be reserved (list in the import issue).
Enforce in `user.service.ts` and `PATCH /api/account/credentials`
(`AddCredentialsModal`) and the admin set-username path. A username that
already exists in the roster but belongs to a different user here is
refused (one roster read), so nobody can take over a laptop account that
was never imported. Existing non-conforming usernames: the account card
says "not usable on laptops; change it".

**Failure handling.** A Spaces write failure must not fail the user's
action: mark `User.laptop_roster_dirty = true` (new column), return
normally, and let a scheduled job `laptop-roster-push` (hourly; pattern
`jobs/workspace-delete.job.ts`, registered in `scheduler.service.ts`
`seedDefaults`) retry dirty rows. The same job backs the admin "Push all
laptop accounts" button (`POST /api/admin/laptop/push-all`), used once
after the import and whenever the bucket needs repairing.

**Account page.** A "Laptop login" card (`client/src/pages/account/`):
state (ready / locked / set a password to enable / username not valid),
the username, "At the login screen on a League laptop choose Other... and
use this username and password", link to the existing change-password
flow. Admin `UserDetailPanel.tsx` gets the same card plus the flag toggle,
`laptop_roster_dirty` state and "Push now".

**Audit.** `laptop_roster_written`, `laptop_roster_locked`,
`laptop_push_all` events.

## Files

- `server/prisma/schema.prisma` + migration: `allows_laptop_account`,
  `laptop_roster_dirty`
- `server/src/services/laptop/laptop-account.service.ts` (new),
  `server/src/jobs/laptop-roster-push.job.ts` (new),
  `server/src/services/laptop/laptop-roster.client.ts` (write path),
  `server/src/utils/password.ts` (`makeCryptHash`)
- Hooks in `server/src/services/user.service.ts`, `routes/account.ts`,
  `routes/admin/users.ts` (permissions, deactivate), passphrase signup
  handler, `merge-suggestion.service.ts` (after approve)
- `server/src/routes/admin/laptop.ts` (new: push-all), `scheduler.service.ts`
- Client: `client/src/pages/account/AccountLaptopCard.tsx` (new),
  `Account.tsx`, `AddCredentialsModal` validation copy,
  `admin/UserDetailPanel.tsx`, permissions toggle
- Tests: `tests/server/services/laptop-account.service.test.ts` (fake
  roster client; asserts the exact JSON and that the crypt hash verifies
  against the plaintext with the import issue's verifier), job test, route
  test for username rules and push-all.

## Verification

1. Student sets username `alice` + password → fake roster gets
   `students/alice/config.json` with a `$6$` hash that verifies;
   `created_host: student-accounts`.
2. Password change → new hash, `created` preserved. Admin flag off →
   `password_hash: "!"`; on → real hash. Deactivate → `!`.
3. `Alice`, `student`, `ab` rejected; `alice-2` accepted; an id present in
   the roster for another user is rejected.
4. Write failure → user action succeeds, `laptop_roster_dirty` set, the
   job clears it on the next tick with a working client.
5. End to end (manual, after deploy): create the account on the web, then
   on a laptop choose Other... and log in; `league-helper login` says
   `ok roster`.

## Open

- **Rename.** Changing a username that has a roster entry means moving
  `students/<old>/` to `students/<new>/` (the laptops' `league-helper
  rename` does that and writes `renamed_from`). Not in this issue: once a
  roster entry exists, the username field is locked for students
  ("ask a teacher"), and admins get a follow-up issue for a rename that
  moves the bucket contents.

## Dependencies

- Import issue (Spaces client, crypt hash functions,
  `laptop_password_hash`).
- Prod Spaces key with write access to the roster bucket.
