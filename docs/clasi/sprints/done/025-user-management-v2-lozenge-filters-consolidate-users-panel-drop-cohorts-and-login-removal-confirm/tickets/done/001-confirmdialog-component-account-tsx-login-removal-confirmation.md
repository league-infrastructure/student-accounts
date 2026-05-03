---
id: '001'
title: ConfirmDialog component + Account.tsx login removal confirmation
status: done
use-cases:
- SUC-001
- SUC-006
depends-on: []
github-issue: ''
todo: backlog-user-management-v2-account-login-ux-cohort-drop.md
completes_todo: false
---

# ConfirmDialog component + Account.tsx login removal confirmation

## Description

The stakeholder accidentally removed a login provider by clicking the
"Remove" button without realizing it was destructive. The existing code
calls the DELETE endpoint directly with no confirmation. This ticket adds
a reusable `<ConfirmDialog>` component and integrates it into the login
removal flow on the Account page.

The `<ConfirmDialog>` component will also be used by ticket 005
(bulk-suspend and bulk-revoke LLM proxy on the unified Users page),
so it must be general-purpose.

## Acceptance Criteria

- [x] `client/src/components/ConfirmDialog.tsx` exists and exports a default `<ConfirmDialog>` component.
- [x] The component accepts props: `open`, `title`, `message`, `confirmLabel` (default "Confirm"), `cancelLabel` (default "Cancel"), `onConfirm`, `onCancel`.
- [x] The dialog renders as an in-page modal overlay with a backdrop; it does not use `window.confirm()` or `window.alert()`.
- [x] The dialog is styled consistently with the app (uses the same font, color palette, and border-radius as existing panels).
- [x] Pressing Escape or clicking outside the dialog triggers `onCancel`.
- [x] In `Account.tsx` `LoginsSection`, clicking "Remove" opens `<ConfirmDialog>` with title "Remove login" and a message that names the provider (e.g., "Remove the Google login from your account? You can re-link it later by clicking Add Google.").
- [x] Clicking "Confirm" in the dialog issues the DELETE; clicking "Cancel" closes the dialog without issuing the DELETE.
- [x] The existing `window.confirm()` call on the Remove button is fully replaced; none remains.

## Implementation Plan

### Approach

1. Create `client/src/components/ConfirmDialog.tsx` as a standalone modal that uses a `<dialog>` element or a `position: fixed` overlay div (whichever is simpler to style consistently). Keep it under ~80 lines.
2. In `Account.tsx`, locate the `removeLoginMutation` call site in `LoginsSection`. Add two state variables: `confirmOpen: boolean` and `pendingLoginId: number | null`. Replace the direct mutation call with a handler that sets `pendingLoginId` and `confirmOpen = true`. Pass these to `<ConfirmDialog>`.

### Files to create

- `client/src/components/ConfirmDialog.tsx`

### Files to modify

- `client/src/pages/Account.tsx` — add confirm dialog state + `<ConfirmDialog>` usage in `LoginsSection`

### Testing plan

- `tests/client/pages/Account.test.tsx`: add test that clicking "Remove" does NOT immediately call the delete mutation; instead, a confirm dialog appears. Confirm that clicking the dialog's "Confirm" button calls the mutation. Confirm that clicking "Cancel" does not call the mutation.
- Run existing Account tests to confirm no regressions: `npm run test:client -- --testPathPattern Account`

### Documentation updates

None required.
