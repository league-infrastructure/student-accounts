---
status: pending
---

# Laptop accounts are created and managed here; student-accounts writes the roster

## Context

Today a student creates their laptop account **on a laptop**: the Student
Account app (`league-work` in `ubuntu-install`) writes
`students/<id>/config.json` to Spaces with a SHA-512 crypt hash, and offers
rename and password change. Decision (2026-10-17): that moves here.
Students use student-accounts directly, in the browser, from the shared
`student` session on a laptop or from home. The laptop app loses account
creation, rename and password change (tracked in `ubuntu-install`,
`docs/issue-laptop-accounts-move-to-student-accounts.md`). The laptops'
login path (PAM hook reading the roster) is **unchanged**: student-accounts
simply becomes the writer of the roster.

Pairs with `laptop-accounts-sync-from-spaces-roster.md` (the import
direction, which also adds the `$6$` verifier and the Spaces client).

## Scope

- A "Laptop account" feature for students: when a student has a username
  and password here, they also have a laptop account with the same
  credentials. Opt-out per user by admin flag.
- Write `students/<id>/config.json` whenever it must change: account gains
  username+password, password changes, user deactivated/reactivated,
  display name changes.
- Username rules compatible with the roster.
- A Laptop account card on the Account page and in the admin detail panel.
- Rename is **admin-only** and performs the bucket move; students cannot
  rename once a laptop account exists.

## Design

**Flag.** Add `User.allows_laptop_account Boolean @default(true)` (the
existing `allows_league_account` means a Google Workspace account; don't
overload it). Admin permissions route/UI gets the new toggle next to the
others (`routes/admin/users.ts` permissions handler,
`tests/server/admin-user-permissions.routes.test.ts` pattern).

**When the roster entry exists.** `allows_laptop_account && username &&
password_hash && is_active && role == student` (staff/admin opt in by flag
only if wanted; default off for non-students). Any transition into or out
of that state, or a password/display-name change while in it, triggers a
write.

**What is written** (exactly the schema `league-helper create-account`
writes, so laptops need no change):

```json
{"id": "<username>", "display_name": "<display_name>",
 "password_hash": "<sha512-crypt>", "created": "<YYYYMMDDTHHMMSSZ>",
 "created_host": "student-accounts"}
```

Preserve `created`/`created_host` if an entry already exists (read before
write); add `"managed_by": "student-accounts"` and `"updated"`.
Deactivated or opted-out user → write `"password_hash": "!"` (locked; the
laptops reject it) rather than deleting, since `drive/` next to it is the
student's work. Never delete under `students/<id>/`.

**Crypt hash.** The laptops verify with glibc `crypt(3)` SHA-512. We hold
the plaintext only at set/change time, so compute the `$6$` hash then
(same dependency the import issue adds, or `openssl passwd -6` via
`child_process` as a fallback). Store scrypt in `password_hash` as now;
the crypt hash goes only to the roster. Passphrase-only users (no password
set) have no laptop account until they set one.

**Username rules.** Setting or changing a username for a user with the
flag on must satisfy the roster rule `[a-z0-9][a-z0-9-]{2,31}` and avoid
the reserved names (list in the import issue). Enforce in
`user.service.ts` username validation and `PATCH /api/account/credentials`
(`AddCredentialsModal`). Existing users with non-conforming usernames get
the card state "username not valid for laptops; change it to enable".
Also refuse a username that exists in the roster but belongs to a
different user here (check via the roster client), to avoid hijacking a
laptop account that was never imported.

**Rename.** Changing the username of a user who has a roster entry means
moving everything under `students/<old>/` to `students/<new>/` (the
laptops' `league-helper rename` does a bucket move and writes
`renamed_from`). Make this admin-only: `POST /api/admin/users/:id/laptop/rename`
performs the S3 copy+delete (potentially many objects, run as a job with
progress in the audit log), writes the new config.json with
`renamed_from`, then updates `username`. Students see the username field
locked with "ask a teacher to rename" once a laptop account exists.

**Account page card** (`client/src/pages/account/`): "Laptop account":
state (active / locked / not yet: set a username and password / username
invalid), the username, "Use this username and password at the login
screen on a League laptop: choose Other...", and "Change password" links
to the existing credentials flow. No separate password for laptops.

**Audit.** `laptop_roster_written`, `laptop_roster_locked`,
`laptop_rename` events.

**Failure handling.** A Spaces write failure must not fail the user's
action; queue a retry (mark `Login.directory_metadata.roster_dirty = true`
and let the hourly `laptop-sync` job reconcile dirty rows) and surface it
in the admin card.

## Files

- `server/prisma/schema.prisma` (+ migration): `allows_laptop_account`
- `server/src/services/laptop/laptop-roster.client.ts` (write/move methods),
  `server/src/services/laptop/laptop-account.service.ts` (new: decides
  when to write, builds the entry, crypt hash)
- Hooks: `server/src/services/user.service.ts` (credentials/username
  change), `routes/account.ts` (`PATCH /api/account/credentials`),
  `routes/admin/users.ts` (permissions, deactivate), passphrase signup
  handler (user sets credentials)
- `server/src/routes/admin/users.ts` or new `routes/admin/laptop.ts`
  (rename), `server/src/jobs/laptop-sync.job.ts` (dirty-row reconcile)
- Client: `client/src/pages/account/AccountLaptopCard.tsx` (new),
  `Account.tsx`, `AddCredentialsModal` validation copy,
  `admin/UserDetailPanel.tsx` card actions, permissions toggle
- Tests: `tests/server/services/laptop-account.service.test.ts` with a
  fake roster client asserting the exact JSON written; crypt hash
  verified with the import issue's verifier; `tests/server/routes/account.credentials.test.ts`
  for username rules.

## Verification

1. New student signs up with a passphrase and sets username `alice` +
   password → fake roster receives `students/alice/config.json` with a
   `$6$` hash that verifies against the password; `created_host:
   "student-accounts"`.
2. Password change → new hash written; `created` preserved.
3. Admin turns the flag off → `password_hash: "!"` written; on → real hash.
4. Username `Alice` or `student` rejected; `alice-2` accepted.
5. End to end (manual, staging roster bucket or a test id): create the
   account here, then on a laptop choose Other... and log in with it;
   `league-helper login` reports `ok roster`.
6. Admin rename `alice` → `alice-smith`: objects moved, config carries
   `renamed_from`, user's username updated; student's card shows the lock.

## Dependencies

- Import issue first (Spaces client, `$6$` verifier, `laptop` Login).
- Prod needs a Spaces key with **write** access to the roster bucket.
- Laptop-side removal of account management is in `ubuntu-install`; until
  it ships, both sides can write the roster. The import job keeps them
  consistent (laptop-made accounts appear here within the hour).
