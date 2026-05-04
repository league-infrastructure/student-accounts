---
id: '004'
title: Student account creation flow welcome email and force-change-password
status: todo
use-cases:
  - SUC-003
  - SUC-004
depends-on:
  - "001"
github-issue: ''
todo: verify-and-finish-student-account-creation-flow.md
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Student account creation flow welcome email and force-change-password

## Description

Overhaul `WorkspaceProvisioningService.provision()` to bring the on-demand provisioning path
into alignment with the sprint 026 decision to use `/Students` as the OU for all students
(previously only applied in `WorkspaceSyncService.syncStudents`). Additionally, set the
temp password from `GOOGLE_WORKSPACE_TEMP_PASSWORD` and `changePasswordAtNextLogin: true`,
then send a welcome email via `MailService`.

**Depends on ticket 001** — `MailService` must exist before this ticket can use it.

The current service validates cohort assignment and derives `orgUnitPath` from
`cohort.google_ou_path`. That logic is removed entirely.

## Acceptance Criteria

- [ ] `WorkspaceProvisioningService` constructor signature is updated: `cohortRepo` parameter removed; `mailService: MailService` parameter added (same position, 5th arg).
- [ ] `ServiceRegistry` updates the `workspaceProvisioning` instantiation: remove `CohortRepository` arg, add `this.mail`.
- [ ] `provision()` no longer validates `user.cohort_id` or fetches from `CohortRepository`.
- [ ] `createUser` call includes `orgUnitPath: '/Students'` (hard-coded string).
- [ ] `createUser` call includes `password: process.env.GOOGLE_WORKSPACE_TEMP_PASSWORD`. Throws `UnprocessableError` if env var is absent.
- [ ] `createUser` call includes `changePasswordAtNextLogin: true`.
- [ ] After `createUser` succeeds, `mailService.send()` is called with `to` = the student's notification email (fallback: `primary_email`). Body includes new League email address and temp password.
- [ ] If `mailService.send()` throws, the error is logged but `provision()` does not propagate it (fail-soft).
- [ ] `User.cohort_id` is not modified during provisioning.
- [ ] Integration test passes (see Testing Plan).
- [ ] Existing tests that provided `CohortRepository` as the 5th constructor arg are updated to provide a `MailService` mock instead.

## Implementation Plan

### Approach

In `server/src/services/workspace-provisioning.service.ts`:

1. Add `import type { MailService } from './mail.service.js'`.
2. Replace `private readonly cohortRepo: typeof CohortRepository` with `private readonly mailService: MailService` in the constructor.
3. Remove imports for `CohortRepository`.
4. Remove steps 3 and 4 from `provision()` (cohort_id check and cohort lookup + google_ou_path check).
5. In the `createUser` call, replace `orgUnitPath: cohort.google_ou_path` with `orgUnitPath: '/Students'`.
6. Add to `createUser` call:
   ```typescript
   password: (() => {
     const pw = process.env.GOOGLE_WORKSPACE_TEMP_PASSWORD;
     if (!pw) throw new UnprocessableError('GOOGLE_WORKSPACE_TEMP_PASSWORD is not set. Cannot provision Workspace account.');
     return pw;
   })(),
   changePasswordAtNextLogin: true,
   ```
7. After step 7 (persist ExternalAccount) and step 8 (Pike13 writeback), add:
   ```typescript
   // Step 9b: Welcome email (fail-soft)
   const notifEmail = user.notificationEmail ?? user.primary_email;
   if (notifEmail) {
     try {
       await this.mailService.send({
         to: notifEmail,
         subject: 'Welcome to League Accounts',
         text: `Hi ${user.display_name ?? 'there'},\n\nYour League account has been created.\nLeague email: ${workspaceEmail}\nTemporary password: ${process.env.GOOGLE_WORKSPACE_TEMP_PASSWORD}\n\nYou will be prompted to set your own password on first sign-in.`,
       });
     } catch (err) {
       logger.warn({ userId, err }, '[workspace-provisioning] welcome email failed — continuing');
     }
   }
   ```
8. Update the doc-comment header to reflect removed deps and new behavior.

In `server/src/services/service.registry.ts`:
- Remove `CohortRepository` from `WorkspaceProvisioningService` instantiation args.
- Add `this.mail` as the 5th arg.

### Files to Modify

- `server/src/services/workspace-provisioning.service.ts` — major refactor per above
- `server/src/services/service.registry.ts` — update `workspaceProvisioning` instantiation

### Testing Plan

In `tests/server/services/workspace-provisioning.service.test.ts`:
- Update all test constructors: replace 5th arg (`CohortRepository` mock) with a `MailService` mock (`{ isConfigured: () => true, send: jest.fn().mockResolvedValue({ messageId: 'mid' }) }`).
- Remove any cohort-lookup mock setup.
- Add new assertions per test:
  - `createUser` called with `orgUnitPath: '/Students'`.
  - `createUser` called with `password: 'test-temp-password'` (set `GOOGLE_WORKSPACE_TEMP_PASSWORD` in test env).
  - `createUser` called with `changePasswordAtNextLogin: true`.
  - `mailService.send` called once with `to` = student's notification or primary email.
  - `mailService.send` body contains the new League email and the temp password string.
- Add test: `mailService.send` throws — `provision()` still resolves (fail-soft).
- Add test: `GOOGLE_WORKSPACE_TEMP_PASSWORD` absent — `provision()` throws `UnprocessableError`.
- Verify no test asserts on cohort OU path.

Run: `npm run test:server -- workspace-provisioning`
