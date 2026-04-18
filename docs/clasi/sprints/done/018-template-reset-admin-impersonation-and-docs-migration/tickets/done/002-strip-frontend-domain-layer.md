---
id: '002'
title: Strip frontend domain layer
status: done
use-cases: []
depends-on: []
github-issue: ''
todo: plan-revert-template-app-to-simple-two-button-counter-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 002 — Strip frontend domain layer

## Description

Remove all LEAGUEhub domain pages, components, and routes from the React client. This runs
in parallel with ticket 001 (both are in Group 1). The clean frontend base is required by
tickets 005 (add counter homepage + login page) and 006 (tighten app shell).

Note: Do not replace `LoginPage.tsx` or create `HomePage.tsx` here — those are ticket 005.
Do not modify `AppLayout.tsx` nav arrays or branding here — that is ticket 006.
This ticket is deletion only.

## Files to Delete

**Pages:**
- `client/src/pages/DashboardPage.tsx`
- `client/src/pages/ReviewListPage.tsx`
- `client/src/pages/ReviewEditorPage.tsx`
- `client/src/pages/TemplateListPage.tsx`
- `client/src/pages/TemplateEditorPage.tsx`
- `client/src/pages/CheckinPage.tsx`
- `client/src/pages/FeedbackPage.tsx`
- `client/src/pages/PendingActivationPage.tsx`
- `client/src/pages/LoginPage.tsx` (replaced in ticket 005 — delete stub now)

**Components:**
- `client/src/components/InstructorLayout.tsx`
- `client/src/components/MonthPicker.tsx` — read the file first; delete only if it is
  domain-specific (used exclusively by LEAGUEhub pages). If it is a generic UI component,
  keep it.

**Admin pages (domain-specific panels only):**
- `client/src/pages/admin/InstructorListPanel.tsx`
- `client/src/pages/admin/CompliancePanel.tsx`
- `client/src/pages/admin/VolunteerHoursPanel.tsx`
- `client/src/pages/admin/AdminFeedbackPanel.tsx`

## Files to Modify

**`client/src/App.tsx`:**
- Remove route entries for all deleted pages:
  `/dashboard`, `/reviews/*`, `/templates/*`, `/checkins`, `/feedback/:token`,
  `/pending-activation`, any login route pointing to the old LoginPage.
- Do not add `/` → `HomePage` yet — that is ticket 005.
- Keep all other route entries (About, Account, McpSetup, NotFound, admin routes).

**`client/src/pages/admin/AdminDashboardPanel.tsx` (or `AdminLayout.tsx`):**
- Remove any navigation links to the deleted admin panels
  (InstructorListPanel, CompliancePanel, VolunteerHoursPanel, AdminFeedbackPanel).

**Tests:**
- Delete any client test files that exclusively cover deleted pages or components.

## Acceptance Criteria

- [x] All listed domain pages deleted from `client/src/pages/`
- [x] `InstructorLayout.tsx` deleted
- [x] `MonthPicker.tsx` deleted if domain-specific (decision documented in PR)
- [x] All four domain admin panels deleted from `client/src/pages/admin/`
- [x] `App.tsx` has no route or import referencing deleted pages
- [x] Admin dashboard/layout has no nav links to deleted panels
- [x] `npm run build` (client) succeeds with no TypeScript errors
- [x] `npm run test:client` passes (deleted-feature tests also deleted)
- [x] `grep -ri "InstructorLayout\|MonthlyReview\|ReviewList\|ReviewEditor\|TemplateList\|TemplateEditor\|CheckinPage\|FeedbackPage\|PendingActivation\|DashboardPage" client/src` returns zero hits

## Implementation Plan

1. Read `MonthPicker.tsx` to determine if domain-specific or generic.
2. Delete all listed page files and domain admin panel files.
3. Delete `InstructorLayout.tsx` (and `MonthPicker.tsx` if domain-specific).
4. Edit `App.tsx` — remove dead route imports and `<Route>` elements.
5. Edit admin dashboard/layout — remove dead nav links.
6. Run grep to verify zero remaining references to deleted components.
7. Run `npm run build` (client) to confirm zero TypeScript errors.
8. Run `npm run test:client`.

## Testing

- **Existing tests to run**: `npm run test:client` — infrastructure and kept-feature tests must pass.
- **New tests to write**: None for this ticket (deletion-only work).
- **Verification command**: `npm run build && npm run test:client`
