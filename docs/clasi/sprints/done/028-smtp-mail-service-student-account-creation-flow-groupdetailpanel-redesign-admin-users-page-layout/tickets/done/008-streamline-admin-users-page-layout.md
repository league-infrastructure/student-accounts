---
id: 008
title: Streamline admin users page layout
status: done
use-cases:
- SUC-009
depends-on: []
github-issue: ''
todo: streamline-admin-users-page-layout.md
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Streamline admin users page layout

## Description

The admin users page (`/admin/users`) currently wraps sections in bordered/carded containers
that make the layout feel heavy and boxy. The TODO asks for: removing section boxes while
keeping the header visually distinct, and moving action buttons from below sections to the
right side of each section.

This is a pure layout/styling change. No functional changes to filtering, sorting, search,
bulk operations, or data fetching.

**Note**: The current `AdminUsersPanel.tsx` uses inline `style` props rather than a CSS-module
or Tailwind class system. After reading the file, identify which specific container `<div>`
elements have border/background/padding styles that create the "boxy" appearance, and remove
those styles. The header block should retain whatever visual distinction it already has (e.g.,
background color, typography weight). Action buttons should be repositioned to the right using
`marginLeft: 'auto'` on the button or `justifyContent: 'space-between'` on the section row.

## Acceptance Criteria

- [x] Section-wrapping container `<div>` elements no longer have `border`, `borderRadius`, or `boxShadow` style properties that create a card/box appearance.
- [x] The user-record header block (name + email addresses) retains its existing visual treatment and remains visually distinct from the body.
- [x] Action buttons (add/revoke access, or their equivalents for this component) are right-aligned within their section row rather than positioned below the section content.
- [x] All existing functionality still works: role filter, feature filter, search, sortable columns, bulk actions, row action menu, make-admin toggle, pagination.
- [x] `npm run test:client -- AdminUsersPanel` passes (existing tests should not need changes unless they were asserting on specific style values).

## Implementation Plan

### Approach

1. Read `client/src/pages/admin/AdminUsersPanel.tsx` in full to identify:
   a. Which `<div>` elements use `border`, `background`, `borderRadius`, `boxShadow` as section wrappers (not as inline chips/badges).
   b. Which action buttons sit below section content.
2. For each section-wrapper `<div>`: remove or zero-out the box-creating style properties. Keep `padding` only if it provides comfortable spacing without visual boxing.
3. For action buttons: if a button is in a `<div>` with `display: flex; flexDirection: column`, change to `display: flex; justifyContent: 'space-between'; alignItems: 'center'` so the content is on the left and the button is on the right. Or add `marginLeft: 'auto'` to the button.
4. Do not touch the header section's visual treatment — keep it as-is.
5. After edits, verify the page renders correctly in the dev server (manual check) and that all automated tests still pass.

### Files to Modify

- `client/src/pages/admin/AdminUsersPanel.tsx` — style changes only

### Testing Plan

Existing tests in `tests/client/pages/AdminUsersPanel.test.tsx` (if they exist) should continue
to pass without modification, since they test functional behavior, not styling.

If the test suite does not currently cover `AdminUsersPanel`, write a minimal smoke test:
- Render with a fixture list of users.
- Assert the filter lozenge bars are present.
- Assert the user table rows render.
- Assert no JavaScript errors during render.

Run: `npm run test:client -- AdminUsersPanel`

Manual check: load `/admin/users` in the dev browser and confirm the layout is flatter, the
header is still distinct, and action buttons are right-aligned.
