---
id: "008"
title: "Add Pike13 snippet section and Unlink/copy fixes to UserDetailPanel"
status: todo
use-cases: [SUC-009-005, SUC-009-006]
depends-on: ["002"]
github-issue: ""
todo: ""
---

# Add Pike13 snippet section and Unlink/copy fixes to UserDetailPanel

## Description

Three changes to `UserDetailPanel.tsx`:

1. **Pike13 Record snippet section** — new section that fetches
   `GET /api/admin/users/:id/pike13` (created in T002) and displays the
   person's live Pike13 data, or an inline error banner if Pike13 is
   unreachable, or nothing if the user has no Pike13 account.

2. **Rename "Remove" to "Unlink" in the Logins section** — copy change only;
   no behavior change. The last-Login guard is unchanged.

3. **Verify/improve button copy on External Accounts** — confirm that the
   Remove button on workspace accounts reads "Delete League Account" and that
   Claude account buttons read "Disable Claude" / "Delete Claude" instead of
   generic "Suspend" / "Remove".

## Acceptance Criteria

- [ ] A "Pike13 Record" section appears below External Accounts when
      `GET /api/admin/users/:id/pike13` returns `{ present: true, person }`.
- [ ] The section shows: display name, email(s), phone, account status,
      "League Email Address" custom field value, "GitHub Username" custom field
      value.
- [ ] When `{ present: true, error }` is returned, the section shows an inline
      amber/red banner: "Pike13 data unavailable: [error message]".
- [ ] When `{ present: false }`, the section is not rendered (or shows a
      "No Pike13 account" note — ticket engineer's discretion).
- [ ] The Pike13 fetch is independent of the main user detail fetch — a
      Pike13 API failure does not break the rest of the detail view.
- [ ] In the Logins section, the button label is "Unlink" (was "Remove").
      The last-Login guard behavior is unchanged.
- [ ] On the External Accounts section, workspace Remove button label is
      "Delete League Account" (or equivalent — confirm exact wording with
      stakeholder). If already correct, note this in the commit message.
- [ ] Claude account buttons: Suspend button reads "Disable Claude"; Remove
      button reads "Delete Claude". If already correct, note it.

## Implementation Plan

**Files to modify:**
- `client/src/pages/admin/UserDetailPanel.tsx`

**Pike13 section approach:**
```typescript
const [pike13Data, setPike13Data] = useState<Pike13Result | null>(null);

useEffect(() => {
  if (!id) return;
  fetch(`/api/admin/users/${id}/pike13`)
    .then(r => r.json())
    .then(setPike13Data)
    .catch(() => setPike13Data({ present: true, error: 'Network error' }));
}, [id]);
```

Render the section below External Accounts, conditionally on `pike13Data`.

**Testing plan:**
- Manual: open detail page for a user with a Pike13 account (use dev seed
  or a test user). Verify snippet renders or shows graceful error.
- Manual: open detail page for a user without Pike13. Verify no section or
  a "No Pike13 account" note.
- Manual: verify "Unlink" label in Logins section.
- Manual: verify External Accounts button copy.

**Documentation updates:** None required.
