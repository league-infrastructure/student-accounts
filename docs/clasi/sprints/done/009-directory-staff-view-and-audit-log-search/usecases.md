---
sprint: "009"
status: active
---

# Sprint 009 — Use Cases

Sprint-level use case IDs are prefixed `SUC-009-NNN`. They reference the
canonical project use cases in `docs/clasi/design/usecases.md` where
applicable.

---

## SUC-009-001: Admin Views Filtered User Directory

**Source:** New admin directory capability

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- At least one User record exists.

**Main Flow:**
1. Administrator navigates to `/admin/users`.
2. App displays all active Users in a table sorted by Name ascending (default).
3. Administrator types in the search box; the table filters to rows where
   the name or email substring matches, within the currently active filter.
4. Administrator opens the Filter dropdown and selects one of:
   - Role section: All, Admin & Staff, Students.
   - Accounts section: Google, League, Pike13 (filters to users who have that
     provider or external account type).
   - Cohort section: one entry per Cohort that has a `google_ou_path` set.
5. Table updates immediately (client-side filtering).
6. Administrator clicks a sortable column header (Name, Email, Cohort, Admin,
   Joined); the table re-sorts. Clicking the active column header toggles
   ascending/descending. Active sort column shows a triangle indicator.

**Postconditions:**
- Administrator sees the filtered, sorted user list. No data is modified.

**Error Flows:**
- No users match the combined search + filter: empty table with "No users
  match this filter." message.

---

## SUC-009-002: Admin Uses Row Actions Menu

**Source:** New row-actions UX

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- At least one User row is visible.

**Main Flow:**
1. Administrator clicks the three-dot button on a user row.
2. A dropdown menu appears with: Edit, Delete, Impersonate.
3. Edit: navigates to `/admin/users/:id`.
4. Impersonate: existing impersonation flow executes.
5. Delete: a confirmation dialog appears; on confirm, `DELETE /api/admin/users/:id`
   is called; the row is removed from the table.
6. The menu closes on outside click.

**Constraints:**
- Edit, Delete, and Impersonate are all disabled on the administrator's own row.

**Postconditions:**
- The selected action is executed. For Delete, the user is removed from the table.

**Error Flows:**
- Delete API call fails: error banner shown; row remains in table.

---

## SUC-009-003: Admin Uses Bulk Delete

**Source:** New bulk-actions capability

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- At least one row (other than own row) is visible.

**Main Flow:**
1. Administrator checks one or more row checkboxes (own row has no checkbox).
2. A bulk-action toolbar appears above the table: "N selected — [Edit] [Delete]".
3. Administrator clicks Delete; a confirmation dialog appears listing the count.
4. On confirm, app calls `DELETE /api/admin/users/:id` for each selected user
   in parallel.
5. Per-row failures are collected and surfaced in a banner. Successful
   deletions are removed from the table.
6. Edit bulk action is a stub for future iteration; clicking it does nothing.

**Postconditions:**
- Successfully deleted users are removed from the table.

**Error Flows:**
- One or more deletions fail: banner lists failing user names; successful
  deletions are not reversed.

---

## SUC-009-004: Admin Views Name and Email as Profile Links with Prettified Names

**Source:** New name prettification and link UX

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.

**Main Flow:**
1. In the Users table, the Name column renders a display name derived by
   `prettifyName(user)`:
   - If `primary_email` ends with `@jointheleague.org` and the local part
     matches `^[a-z]+\.[a-z]+$`, return `TitleCase(first) + " " + TitleCase(last)`.
   - Otherwise fall back to `displayName` or the email local part.
2. The Name cell is rendered as a `<Link>` to `/admin/users/:id`.
3. The Email cell is also rendered as a `<Link>` to `/admin/users/:id`.

**Postconditions:**
- Clicking either link navigates to the user detail page.

---

## SUC-009-005: Admin Views Pike13 Record Snippet on User Detail Page

**Source:** New endpoint and detail-page section

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Target User has a Pike13 ExternalAccount (`type=pike13`, any status).

**Main Flow:**
1. Administrator opens `/admin/users/:id`.
2. The UserDetailPanel fetches `GET /api/admin/users/:id/pike13`.
3. If the user has a Pike13 account, the endpoint returns
   `{ present: true, person: { ... } }` with fields fetched live from the Pike13 API.
4. The panel renders a "Pike13 Record" section with: display name, email(s),
   phone, account status, "League Email Address" custom field, "GitHub Username"
   custom field.
5. If the Pike13 API call fails, the endpoint returns
   `{ present: true, error: string }` and the panel shows an inline error banner.
6. If the user has no Pike13 account, the endpoint returns `{ present: false }`
   and the section is omitted.

**Postconditions:**
- Administrator can see the live Pike13 data. No data is modified.

---

## SUC-009-006: Admin Unlinks a Login (Rename Remove to Unlink)

**Source:** UC-009 — copy/label change only

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- Target User has at least two Logins.

**Main Flow:**
1. Administrator opens the User detail view.
2. In the Logins section, buttons previously labeled "Remove" are now labeled
   "Unlink".
3. Clicking "Unlink" on a Login with at least one other remaining Login removes
   that Login record.
4. Blocked if the user would have zero Logins remaining (guard unchanged).

**Postconditions:**
- Login is removed. At least one Login remains. AuditEvent recorded.

---

## SUC-009-007: Staff Member Views Read-Only Student Directory

**Source:** UC-022

**Actor:** Staff member (role=staff)

**Preconditions:**
- Staff member is signed in via UC-003.
- Staff member has `role=staff`.

**Main Flow:**
1. Staff member is redirected to `/staff/directory` after sign-in (or navigates
   there directly).
2. App renders a read-only listing of all Users with `role=student` org-wide.
   No per-cohort restriction.
3. Staff member can search by name or email (client-side substring).
4. Staff member can filter by cohort and External Account status (has Workspace,
   has Claude seat, has Pike13 link).
5. Staff member clicks a student row; a read-only profile view renders:
   display name, email, cohort, External Account statuses. No action buttons.

**Constraints:**
- No provisioning, merge, or audit-log actions are exposed.
- Any write request to a staff-scoped API endpoint returns 403.

**Postconditions:**
- Staff member viewed student data. No changes to any records.

---

## SUC-009-008: Admin Searches Audit Log

**Source:** UC-023

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- AuditEvent records exist.

**Main Flow:**
1. Administrator navigates to `/admin/audit-log`.
2. A filter form is displayed: target user (text), actor (text), action type
   (dropdown), date range (start date, end date).
3. Administrator applies one or more filters.
4. App calls `GET /api/admin/audit-log` with filter query parameters.
5. Results are displayed in reverse chronological order: timestamp, actor,
   action, target user, details summary.
6. Administrator clicks a row to view the full details JSON inline.
7. Pagination controls navigate large result sets (page-based).

**Postconditions:**
- Administrator viewed matching audit records. No changes to records.

**Error Flows:**
- No records match the filters: empty result with "No results." message.

---

## SUC-009-009: Role-Based Landing Page Routing

**Source:** New — cleanup of placeholder redirects

**Actor:** Any authenticated user

**Main Flow:**
1. User signs in successfully.
2. App routes based on role:
   - `admin` or `ADMIN` role: redirected to `/admin/users`.
   - `staff` role: redirected to `/staff/directory`.
   - `student` role: redirected to `/account`.
3. Staff cannot access `/admin/*` routes (403 or redirect).
4. Students cannot access `/admin/*` or `/staff/*` routes (403 or redirect).

**Postconditions:**
- Users land on the correct page for their role with no placeholder redirects.
