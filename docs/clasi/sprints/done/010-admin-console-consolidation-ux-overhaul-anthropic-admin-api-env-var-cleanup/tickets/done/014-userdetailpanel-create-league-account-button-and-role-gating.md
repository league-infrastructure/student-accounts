---
id: '014'
title: "UserDetailPanel — Create League Account button and role gating"
status: done
use-cases:
  - SUC-010-004
depends-on:
  - "010-004"
  - "010-006"
github-issue: ''
todo: plan-admin-ux-overhaul-dashboard-route-split-user-detail-account-lifecycle.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# UserDetailPanel — Create League Account button and role gating

## Description

Extend `UserDetailPanel.tsx` with two changes:

1. **"Create League Account" button**: shown for `role=student` users who
   have a cohort assigned and no active `type=workspace` ExternalAccount.
   Posts to the new `POST /api/admin/users/:id/provision-workspace` endpoint
   (T004). On success, re-fetches the user detail.

2. **Role gating on lifecycle buttons**: For `role=staff` and `role=admin`
   user rows, hide all ExternalAccount lifecycle buttons (Create, Suspend,
   Delete). The External Accounts section renders read-only on those rows.
   Students retain all existing lifecycle buttons.

Depends on T004 (the server endpoint) and T006 (nav changes have no direct
dependency here, but the UserDetailPanel is now at `/users/:id` not
`/admin/users/:id` — T006 nav changes make this consistent).

## Acceptance Criteria

- [x] "Create League Account" button appears in the Workspace section when: `user.role === 'student'` AND the user has a cohort assigned AND no active `type=workspace` ExternalAccount exists.
- [x] Button is hidden if any of the above conditions is not met.
- [x] Clicking the button POSTs to `POST /api/admin/users/:id/provision-workspace`.
- [x] On 201 success: button disappears, user detail re-fetches, active workspace ExternalAccount row appears.
- [x] On 422 error: inline error message shown near the button; button is not disabled permanently.
- [x] For `role=staff` user rows: Workspace section shows ExternalAccount list read-only. No "Create League Account", Suspend, or Delete buttons. Same for Claude section.
- [x] For `role=admin` user rows: same read-only treatment.
- [x] For `role=student` user rows: existing "Create Claude Seat", Suspend, and Delete buttons remain present as before.
- [x] Component tests cover: student with no workspace shows Create button; student with active workspace hides Create button; staff row hides all lifecycle buttons; create action triggers correct POST and re-fetch.
- [x] `npm run test:client` passes.

## Implementation Plan

### Files to Modify

**`client/src/pages/admin/UserDetailPanel.tsx`**

Study the existing file carefully before editing:
- Understand where the Workspace section is rendered.
- Find the pattern used by "Create Claude Seat" button (POST to provision-claude) — use the exact same pattern for the new button.
- Find where Suspend/Delete buttons are conditionally rendered — add a role check around them.

Changes:
1. In the Workspace section: add a condition `user.role === 'student' && user.cohortId && !activeWorkspaceAccount`. Render the "Create League Account" button inside this condition.
2. Button click handler: `useMutation` posting to `/api/admin/users/${user.id}/provision-workspace`. On success, invalidate the user detail query.
3. For each ExternalAccount lifecycle button (Suspend, Delete, Create), wrap with `user.role === 'student'` condition.

### Testing Plan

**`tests/client/pages/admin/UserDetailPanel.test.tsx`** (or create new file)

Mock fetch. Scenarios:
- Student, no workspace, has cohort → Create League Account button visible.
- Student, has active workspace → Create League Account button hidden.
- Student, no cohort → Create League Account button hidden.
- Staff user → no lifecycle buttons rendered.
- Admin user → no lifecycle buttons rendered.
- Create action → POST `/api/admin/users/123/provision-workspace` fired, success → user detail refetched.

Run `npm run test:client`.
