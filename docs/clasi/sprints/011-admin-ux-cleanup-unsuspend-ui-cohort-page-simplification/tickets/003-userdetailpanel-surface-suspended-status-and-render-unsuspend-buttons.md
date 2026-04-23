---
id: "003"
title: "UserDetailPanel: surface suspended status and render Unsuspend buttons"
status: todo
use-cases: ["SUC-011-001"]
depends-on: ["001"]
github-issue: ""
todo: "admin-user-page-unsuspend-ui.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# UserDetailPanel: surface suspended status and render Unsuspend buttons

## Description

Update `/users/:id` so suspended workspace and claude
`ExternalAccount`s are no longer invisible, and give the admin a
direct Unsuspend lever.

- The **Student account** card shows the `StatusPill` when the
  workspace ExternalAccount is in any status, and renders an
  **Unsuspend** button when `status === 'suspended'`.
- The **Claude** card always shows the `StatusPill` and
  `Anthropic ID`. When `status === 'suspended'` and the
  `external_id` begins with `invite_`, an **Unsuspend** button
  appears. When the id begins with `user_` (or anything not
  `invite_*`), the card renders a non-button informational hint
  explaining that re-activation requires delete + re-provision.
- Unsuspend buttons POST to
  `/api/admin/external-accounts/:id/unsuspend` and refresh on
  success. Errors surface in the existing action-error banner.

## Acceptance Criteria

- [ ] A suspended workspace ExternalAccount's Student account card displays the literal status "suspended" via `StatusPill`.
- [ ] A suspended workspace ExternalAccount's card renders an Unsuspend button that calls `POST /api/admin/external-accounts/:id/unsuspend` and refreshes on success.
- [ ] A suspended claude ExternalAccount's card displays "suspended" via `StatusPill`.
- [ ] A suspended claude ExternalAccount with `invite_*` external_id renders an Unsuspend button.
- [ ] A suspended claude ExternalAccount with a non-`invite_*` external_id renders a clear informational hint instead of an Unsuspend button.
- [ ] All action buttons are disabled during an in-flight Unsuspend request.
- [ ] Server errors surface in the existing action-error banner.
- [ ] `npm run test:client` passes.

## Plan

### Files to modify
- `client/src/pages/admin/UserDetailPanel.tsx`

### Approach
1. Derive `suspendedWorkspaceAcct` and adjust the existing
   `studentWorkspaceAcct` rendering so the Student account card
   always shows the StatusPill.
2. Add `unsuspendExternal(account)` action helper.
3. In the Claude card, always render StatusPill + Anthropic ID; show
   an Unsuspend button when suspended + invite_* id, and a hint
   otherwise.

### Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write**: None required for a handwritten RTL test
  unless an existing test file for this component already exists.
- **Verification command**: `npm run test:client`
