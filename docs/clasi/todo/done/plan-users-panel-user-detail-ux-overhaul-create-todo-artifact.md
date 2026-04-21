---
status: done
sprint: 009
tickets:
- 009-001
---

# Plan — Users panel + user detail UX overhaul (create TODO artifact)

## Context

The admin Users panel ([client/src/pages/admin/UsersPanel.tsx](client/src/pages/admin/UsersPanel.tsx)) needs search, sort, a unified filter dropdown (replacing the tabs that don't indicate the active group), prettified names, row checkboxes + bulk actions, a ⋮ row-actions menu, and links from name/email to a richer user detail page. The detail page ([client/src/pages/admin/UserDetailPanel.tsx](client/src/pages/admin/UserDetailPanel.tsx)) already covers most per-account lifecycle actions (suspend/remove workspace and claude, add/remove Login) but lacks a Pike13-record snippet. This plan captures it all as a CLASI TODO for a future sprint.

Stakeholder decisions captured:
- "Admin & Staff" is a single combined group.
- Include row checkboxes + a bulk-action toolbar (Edit / Delete).
- Default sort: Name ascending.

## Deliverable

A CLASI TODO in `docs/clasi/todo/` capturing the spec below. **Not implementation.** The `/todo` skill persists this into the project's CLASI planning inbox for a future sprint.

## Spec (for the TODO body)

### Header row — single line, left → right

1. **Search box** — substring match across name + email, applied WITHIN the current filter selection.
2. **Filter dropdown** — replaces the current tabs; label reflects the current selection (e.g., "Filter: Spring 2025"). Structure:

   ```
   Role
     All
     Admin & Staff        (role=admin OR role=staff)
     Students             (role=student, any cohort or none)
   ---
   Accounts
     Google               (has a Google Login, i.e. Login.provider='google')
     League               (has an ExternalAccount type=workspace, any status)
     Pike13               (has an ExternalAccount type=pike13, any status)
   ---
   Cohort
     <cohort 1 name>
     <cohort 2 name>
     …                    (one entry per Cohort row with a google_ou_path)
   ```

   Selecting a cohort filters to students in that cohort. Section labels are visual headers (non-selectable). The "---" lines are separators.

3. (When ≥1 row checked) **Bulk-action toolbar** above the table: `"N selected — [Edit] [Delete]"`.

### Table columns

| # | Column | Sortable | Notes |
|---|--------|----------|-------|
| 1 | ☐ | — | Header checkbox toggles all visible rows. |
| 2 | Name | ✓ | Rendered as a `<Link>` to `/admin/users/:id`. See **Name derivation**. |
| 3 | Email | ✓ | Also rendered as a `<Link>` to `/admin/users/:id`. |
| 4 | Cohort | ✓ | Student → cohort name; admin/staff → "admin"/"staff" chip. Admin/staff pinned to top on sort. |
| 5 | Providers | — | Unchanged. |
| 6 | Admin | ✓ | Checkbox; sorted with admin users first. |
| 7 | Joined | ✓ | Date sort. |
| 8 | ⋮ | — | Three-dot menu — see **Row actions**. |

Sortable headers show ▲/▼ for the active sort column; clicking toggles direction. Default: Name ↑.

### Name derivation (display only — DB unchanged)

If `email` ends with `@jointheleague.org` and the local part matches `^[a-z]+\.[a-z]+$`:
- Display `TitleCase(first) + " " + TitleCase(last)` (e.g., `eric.busboom@jointheleague.org` → `Eric Busboom`).

Otherwise fall back to `displayName` or the email local part. Implement as `prettifyName(user)` co-located with `UsersPanel.tsx`.

### Row actions (⋮ menu)

Replace current Impersonate button + View link with a three-dot dropdown per row:

- **Edit** → navigates to `/admin/users/:id`.
- **Delete** → confirmation dialog; `DELETE /api/admin/users/:id`. Disabled for the current admin's own row.
- **Impersonate** → existing flow. Disabled for the current admin's own row.

Closes on outside click. Reuse the dropdown pattern from [client/src/components/AppLayout.tsx](client/src/components/AppLayout.tsx) (user-menu dropdown) — no new deps.

### Bulk actions

When ≥1 row checked, show `"N selected — [Edit] [Delete]"` above the table.
- **Delete** — confirmation dialog → parallel `DELETE /api/admin/users/:id` per row; per-row failures surfaced in a banner.
- **Edit** — stub for this TODO; future iteration can add bulk role/cohort assignment.

## User detail page additions ([client/src/pages/admin/UserDetailPanel.tsx](client/src/pages/admin/UserDetailPanel.tsx))

The detail page already covers most "everything you can do to this user" via T011 from Sprint 005:
- Logins section with per-row Remove (disabled on last Login) + Add Google/GitHub Login.
- External Accounts with Suspend/Remove per row (Workspace suspend-then-3-day-delete, Claude immediate release).
- Provision Claude Seat (gated by active workspace account).
- Deprovision Student (composite remove for students).

**New for this TODO:**

1. **Pike13 record snippet** — new section showing key fields pulled live from Pike13 for the user's pike13 ExternalAccount (if any). Fields: display name, email(s), phone, account status, custom-field values for "League Email Address" and "GitHub Username". Requires a new admin endpoint:

   - `GET /api/admin/users/:id/pike13` — returns `{ present: false }` if no pike13 ExternalAccount, else `{ present: true, person: { … } }` fetched via `Pike13ApiClient.getPerson(external_id)`. Fail-soft: return `{ present: true, error: string }` on API failure so the UI can render a graceful error banner inline.

2. **Disassociate (unlink) verbs** — already present via the Logins section's Remove. Rename the button from "Remove" to "Unlink" to match the stakeholder's language. Same last-Login guard applies.

3. **Delete League workspace account** — already present (Remove button on the workspace ExternalAccount); verify copy reads "Delete League Account" or similar for a student's Workspace row.

4. **Delete / disable Claude** — already present (Suspend / Remove on the claude ExternalAccount). Verify the button labels are "Disable Claude" / "Delete Claude" rather than generic Suspend/Remove for clarity.

## Files to touch (for the TODO body)

- [client/src/pages/admin/UsersPanel.tsx](client/src/pages/admin/UsersPanel.tsx) — all header, filter, sort, checkbox, ⋮-menu, name-link changes.
- [client/src/pages/admin/UserDetailPanel.tsx](client/src/pages/admin/UserDetailPanel.tsx) — add Pike13 snippet section; rename Remove→Unlink on Logins; refine button copy on ExternalAccounts.
- New server route — `server/src/routes/admin/users.ts`: add `GET /users/:id/pike13` using the injected `Pike13ApiClient` via `req.services`. No schema changes.
- No changes to existing list endpoint (it already returns cohort + providers from recent work).

## Out of scope

- Server-side search/sort/pagination (client-side fine for ≤400 users; revisit when needed).
- Bulk role/cohort assignment UI (keep Bulk Edit as a stub).
- Pike13 write-back from the detail page (Sprint 006 writeback happens on login-add / provisioning — no ad-hoc UI button in this iteration).

## Verification

Once implemented:
- Manual: type in search box, pick each filter-dropdown entry (role, accounts, cohort), sort each column, open ⋮ menus, impersonate, bulk-check + delete a test user, click a name/email link, open detail page for a Pike13-linked user and verify the snippet renders (or errors gracefully when Pike13 is unreachable).
- Server: new route test for `GET /admin/users/:id/pike13` covering present/absent/api-error paths using `FakePike13ApiClient`.

## Next action

Run the `/todo` skill with the title "Admin users panel UX + user detail page Pike13 snippet" and paste the spec sections above as the body.
