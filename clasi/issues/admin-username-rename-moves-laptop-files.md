---
status: pending
---

# Admin username rename should move the student's laptop files in the bucket

## Context

Usernames are fixed once set; only admins can change them (2026-10-18). A
laptop login is the account's username + password, and the laptops sync a
student's work to `students/<username>/drive/` in the roster bucket. When an
admin renames a user, the app now writes the new roster entry and locks the
old one (`!`), but the student's files stay under the old prefix, so on the
laptops the renamed student starts with an empty home.

## Scope

- On admin rename, move `students/<old>/` (drive/, journal/, cold/, config.json
  history) to `students/<new>/` in Spaces (server-side copy + delete, possibly
  many objects; run as a background job with progress in the audit log), then
  write the new config.json with `renamed_from: <old>` and lock the old entry.
- The laptops' retired `league-helper rename` did exactly this move; mirror its
  layout (see ubuntu-install `machine-config/files/league-helper`, `do_rename`).
- Admin UI: the credentials card warns that a rename moves laptop files and
  shows the job's result.

## Verification

Rename a test user with files under the old prefix in a fake roster/bucket;
objects appear under the new prefix, old entry locked, new entry carries
`renamed_from`; a laptop login as the new name pulls the files.
