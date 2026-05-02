---
sprint: "024"
status: final
---

# Use Cases — Sprint 024

## SUC-001: Sidebar reflects intended user-management hierarchy

**Actor:** Admin or Staff user  
**Precondition:** User is authenticated and the sidebar User Management group is visible.  
**Goal:** Navigate to any user-management page using an intuitive, ordered sidebar.

**Main flow:**

1. User opens the sidebar.
2. The User Management group displays items in this order:
   Users, Students, Staff, LLM Proxy Users, Groups, Cohorts.
3. Each item uses the stakeholder-defined label ("Staff" not "Staff Directory",
   "Students" not "League Students").
4. Clicking a label navigates to the correct route without a redirect.

**Postcondition:** User arrives at the desired page in one click.

**Acceptance Criteria:**
- [ ] Sidebar order matches: Users, Students, Staff, LLM Proxy Users, Groups, Cohorts.
- [ ] Label "Staff Directory" is replaced by "Staff".
- [ ] Label "League Students" is replaced by "Students".
- [ ] All six items link to their existing routes (no route renames).

---

## SUC-002: All-users page at /admin/users

**Actor:** Admin  
**Precondition:** Admin is on the Users page (`/admin/users`).  
**Goal:** See every user in the system with full search, sort, and Joined column
functionality, plus the ability to grant or revoke admin access for staff users.

**Main flow:**

1. Admin navigates to Users.
2. All active users are listed — not just staff.
3. Admin types in the search bar to filter by name or email in real time.
4. Admin clicks a column header (Name, Email, Cohort, Accounts, Joined) to
   sort ascending; clicks again to sort descending.
5. For a row belonging to a staff or admin user, an action button allows
   toggling admin status (make admin / remove admin).
   Self-demotion and last-admin demotion are blocked with appropriate feedback.

**Postcondition:** Selected user's role is updated; list refreshes.

**Acceptance Criteria:**
- [ ] Page shows all users (not filtered to staff).
- [ ] Search bar filters by name or email.
- [ ] All column headers are sortable; Joined column is present.
- [ ] Make-admin / remove-admin action appears for staff/admin rows.
- [ ] Self-demotion button is disabled.
- [ ] Last-admin demotion button is disabled.
- [ ] UsersPanel.tsx is deleted; no routes point to it.

---

## SUC-003: Students list with search and sortable columns

**Actor:** Admin  
**Precondition:** Admin is on the Students page (`/users/students`).  
**Goal:** Locate a specific student and sort by any column including Joined date.

**Main flow:**

1. Admin navigates to Students.
2. All active student-email users are listed; Joined column is already present.
3. Admin types in the search bar to filter by name or email.
4. Admin clicks a column header (Name, Email, Cohort, Accounts, Joined) to sort.
5. Sort toggles between ascending and descending on repeated clicks of the same header.

**Postcondition:** List is filtered and sorted as requested.

**Acceptance Criteria:**
- [ ] Search bar filters by name or email.
- [ ] Every column header is clickable and toggles sort direction.
- [ ] Joined column sorts correctly by `createdAt`.

---

## SUC-004: Staff list with Joined date and sortable columns

**Actor:** Admin or Staff  
**Precondition:** User is on the Staff page (`/staff/directory`).  
**Goal:** Find a specific student in the staff-visible directory and sort by
any column including when they joined.

**Main flow:**

1. User navigates to Staff.
2. Existing search bar, cohort filter, and account-type filter are preserved.
3. A Joined column is now visible showing each student's account creation date.
4. User clicks any column header (Name, Email, Cohort, Accounts, Joined) to sort.
5. Sort direction toggles on repeated header clicks.

**Postcondition:** List is filtered and sorted as requested.

**Acceptance Criteria:**
- [ ] Joined column is present and shows a formatted date.
- [ ] All column headers are sortable.
- [ ] Existing search bar, cohort filter, and account-type filter still work.

---

## SUC-005: LLM Proxy Users list with search and sortable columns

**Actor:** Admin  
**Precondition:** Admin is on the LLM Proxy Users page (`/users/llm-proxy`).  
**Goal:** Find a specific proxy-token holder and sort by any column.

**Main flow:**

1. Admin navigates to LLM Proxy Users.
2. A search bar filters the visible rows by name or email in real time.
3. Admin clicks a column header (Name, Email, Cohort, Usage, Expires) to sort.
4. Sort direction toggles on repeated clicks.

**Postcondition:** List is filtered and sorted as requested.

**Acceptance Criteria:**
- [ ] Search bar filters by name or email.
- [ ] All column headers are sortable (Name, Email, Cohort, Usage, Expires).

---

## SUC-006: Cohorts list with search bar

**Actor:** Admin  
**Precondition:** Admin is on the Cohorts page (`/cohorts`).  
**Goal:** Quickly find a cohort by name.

**Main flow:**

1. Admin navigates to Cohorts.
2. A search bar filters visible rows by cohort name in real time.
3. Existing sortable column headers remain functional.

**Postcondition:** List is filtered to matching cohorts.

**Acceptance Criteria:**
- [ ] Search bar is present above the table.
- [ ] Typing filters rows by cohort name.
- [ ] Existing sort functionality is not broken.

---

## SUC-007: Groups list with search bar

**Actor:** Admin  
**Precondition:** Admin is on the Groups page (`/groups`).  
**Goal:** Quickly find a group by name or description.

**Main flow:**

1. Admin navigates to Groups.
2. A search bar filters visible rows by group name (and description) in real time.
3. Existing sortable column headers remain functional.

**Postcondition:** List is filtered to matching groups.

**Acceptance Criteria:**
- [ ] Search bar is present above the table.
- [ ] Typing filters rows by group name or description.
- [ ] Existing sort functionality is not broken.
