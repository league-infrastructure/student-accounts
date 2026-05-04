---
status: pending
---

# Verify and finish the student-account creation flow

End-to-end audit and fix of the create-student-account path:
Workspace OU placement, no-cohort, welcome-email with default
password, and force-change-on-first-login.

## What needs to be true

- **Workspace accounts land in `/Students` OU.** Sprint 026 ticket
  006 changed `WorkspaceSyncService.syncStudents` to drop the
  per-cohort OU loop, but the on-demand provisioning paths
  (`WorkspaceProvisioningService`, `provisionUserIfNeeded`,
  `GroupService` per-user toggle) need a re-audit to confirm none
  of them still derive an OU from the user's `cohort_id` or any
  other source. Hard-code `/Students` (or pull from a single
  config var) at every creation call site.
- **No cohort assignment** when creating a student. Skip cohort
  lookup entirely; cohorts are no longer used for OU placement.
  If `User.cohort_id` is still set anywhere in the create path,
  drop the assignment.
- **Use the new signup passphrase + temp-password feature
  (sprint 015).** That's the existing `signup_passphrase` field
  on `Group` plus the `GOOGLE_WORKSPACE_TEMP_PASSWORD` env value.
  The temp password becomes the default password for the newly-
  created Workspace user.
- **Default password set at creation.** Pull from
  `GOOGLE_WORKSPACE_TEMP_PASSWORD` (existing env) and pass to the
  Google Admin Directory `users.insert` call as the `password`
  field.
- **Welcome email** — after the Workspace account is created,
  send an email to the student's *notification email* (the value
  set on the Account page; falls back to `primary_email`)
  containing:
  - Their new League email address (the `@<workspace_domain>`
    address that was just created)
  - The default password
  - A note that they'll be prompted to set their own password at
    first sign-in.
  Uses the SMTP MailService planned in the separate SMTP TODO.
- **Force password change on first sign-in.** Google Admin
  Directory's `users.insert` accepts
  `changePasswordAtNextLogin: true` — set it.

## Implementation notes

- Don't hard-code domains. Read the workspace domain from the
  existing config (`GOOGLE_WORKSPACE_DOMAIN` or whatever already
  carries it). The "studentstart.org" string in the request was a
  voice-transcription artifact; the real domain is e.g.
  `students.jointheleague.org`.
- Single creation pathway: there are several call sites that
  provision Workspace accounts (admin "Create League" button on
  the user grid, the auto-provision triggered by toggling
  `allows_league_account` on the user via the group permission
  grid, possibly a sync path). All of them should funnel through
  one helper that owns the OU + temp-password + welcome-email
  policy. If `provisionUserIfNeeded` (sprint 027 ticket 004) is
  the natural funnel, extend it.

## Smoke test

Add an integration test that exercises the end-to-end create:
- Set up a fixture student User with a notification email.
- Mock the Google Workspace Admin client and the SMTP transport.
- Trigger creation (preferably via the per-user permission
  toggle in `UserService.setPermissions` so the test covers the
  realistic UI-driven path).
- Assert:
  - The `users.insert` call payload had `orgUnitPath:
    '/Students'`, no cohort-derived OU.
  - `User.cohort_id` was not touched.
  - `password` field was set to `GOOGLE_WORKSPACE_TEMP_PASSWORD`.
  - `changePasswordAtNextLogin: true`.
  - `MailService.send` was called once with `to` = the student's
    notification email and a body that includes both the new
    League email and the default password.

## Dependencies

This TODO depends on the **SMTP MailService TODO** landing first
(`docs/clasi/todo/smtp-mail-service-and-account-test-email-button.md`).
Without `MailService`, the welcome-email step has nowhere to
call into.

## Out of scope

- Self-service "I forgot my password" flow.
- Welcome-email branding / templated rendering.
- Provisioning users to non-`/Students` OUs (admins, staff —
  separate path, not changed here).
