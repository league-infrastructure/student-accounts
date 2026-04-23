---
id: '006'
title: "Client \u2014 Groups section on UserDetailPanel"
status: done
use-cases:
- SUC-012-004
depends-on:
- '004'
github-issue: ''
todo: ''
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client — Groups section on UserDetailPanel

## Description

Add a "Groups" section to the admin user detail page showing the
user's current group memberships with inline Add + Remove.

## Acceptance Criteria

- [x] A new `AccountCard`-style section titled "Groups" is rendered
      on `client/src/pages/admin/UserDetailPanel.tsx`, positioned
      between the identity card and the External Google /
      League / Student / Pike13 / Claude cards.
- [x] The section fetches `GET /api/admin/users/:id/groups` on mount
      and whenever the user id changes.
- [x] Each membership is shown with a Remove button. Clicking calls
      `DELETE /api/admin/groups/:groupId/members/:userId`, confirms
      first, and re-fetches on success.
- [x] Below the list: a combobox of groups the user is not in
      (fetched from `GET /api/admin/groups` filtered client-side) and
      an Add button that POSTs to
      `/api/admin/groups/:groupId/members` with `{ userId }`.
- [x] Empty state: "Not in any groups yet." with the add combobox
      visible.
- [x] A narrow, self-contained test in
      `tests/client/pages/UserDetailPanel.groups.test.tsx` (new
      file, avoids conflict with pre-existing Sprint-010 drift in
      `UserDetailPanel.test.tsx`) covers: render current groups,
      remove action, add action, empty state.

## Testing

- **Existing tests to run**: `npm run test:client`.
- **New tests to write**: `UserDetailPanel.groups.test.tsx`.
- **Verification command**: `npm run test:client`.
