---
id: "003"
title: "Restore Workspace temp-password block on Account page"
status: todo
use-cases:
  - SUC-001
depends-on:
  - "001"
github-issue: ""
todo: ""
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Restore Workspace temp-password block on Account page

## Description

Sprint 020 moved the Workspace email + temp-password display from `Account.tsx`
into `Services.tsx` (ticket 005 of sprint 020). Since Services is being deleted
in this sprint, the workspace block must return to `Account.tsx` before deletion.

### What to restore

The block to restore is the League Email row from `ServicesSection` in
`Services.tsx` (lines ~113-134):

- Workspace email address (from the `workspace` ExternalAccount `externalId`
  or from `profile.primaryEmail` if it is a League email).
- The temp-password inline display: when `profile.workspaceTempPassword` is
  set, show `password: <code>{workspaceTempPassword}</code>` next to the email.
- The pending-account banner variant (show "account is pending approval" when
  `profile.approvalStatus === 'pending'`).

### Where to add it in Account.tsx

Add a `WorkspaceSection` (or similar name) component inside `Account.tsx`.
Render it within the student-only section, alongside or below the existing
profile/logins sections. It should:

- Render only for `role === 'student'`.
- Show pending banner when `approvalStatus === 'pending'`.
- Show workspace email + temp-password row when the user has a `workspace`
  ExternalAccount or a League-format email.
- Hide entirely (return `null`) when neither condition applies.

The `isLeagueEmail` helper can be copied from `Services.tsx` or extracted to
a shared utility — implementor's choice.

`Account.tsx` already fetches account data via `useQuery(['account'])`, so no
new API calls are needed.

## Acceptance Criteria

- [ ] `Account.tsx` renders a Workspace block for students with a workspace ExternalAccount.
- [ ] Workspace block shows the League email address from `externalId` or `primaryEmail`.
- [ ] When `profile.workspaceTempPassword` is set, the block displays it inline.
- [ ] Workspace block shows the pending-approval banner when `approvalStatus === 'pending'`.
- [ ] Workspace block is not rendered for staff or admin roles.
- [ ] Workspace block is not rendered for students with no workspace ExternalAccount and a non-League email.
- [ ] Existing `Account.tsx` tests still pass.
- [ ] `npm run test:client` passes.

## Implementation Plan

### Approach

1. Read `ServicesSection` and the `isLeagueEmail` helper in `Services.tsx`.
2. Create a `WorkspaceSection` component in `Account.tsx` (or a separate file
   in `client/src/pages/account/` if preferred for organisation).
3. Render `<WorkspaceSection data={data} />` in the student-only section of
   `Account.tsx`, after the existing profile card.
4. Ensure the component returns `null` when the user has no workspace account
   and no League email, so it vanishes cleanly.
5. Update `tests/client/pages/Account.test.tsx` if needed to cover the new
   block (or add a targeted test for the workspace block).

### Files to modify

- `client/src/pages/Account.tsx` — add `WorkspaceSection` component and render it

### Files to read (source material)

- `client/src/pages/Services.tsx` — `ServicesSection`, `isLeagueEmail`,
  `shouldShowServices` (lines 63-160 approximately)

### Testing plan

- Run `npm run test:client` after changes.
- If existing Account tests mock account data without workspace ExternalAccounts,
  the new block will render `null` and tests should still pass.
- Add one positive test case: student with `workspace` ExternalAccount sees the
  email display and temp-password hint.

### Documentation updates

None — architecture-update.md already describes this restoration.
