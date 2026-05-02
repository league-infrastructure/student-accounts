---
sprint: "025"
status: approved
---

# Use Cases — Sprint 025: User Management v2

## SUC-001: Confirm before removing a login provider

**Actor:** Authenticated user  
**Trigger:** User clicks the "Remove" button next to a linked login provider on Account.tsx  
**Precondition:** User is on the Account page with at least one login row shown

**Main flow:**
1. User clicks "Remove" on a login provider row.
2. A styled in-page `<ConfirmDialog>` appears naming the provider and explaining the consequence ("You can re-link it later by clicking Add {provider}").
3. User clicks "Confirm". The DELETE call is issued and the login is removed.
4. The login row disappears from the Logins section.

**Alternate flow — User clicks Cancel:**
The dialog closes; no DELETE is issued; the login row remains.

**Acceptance criteria:**
- [ ] Clicking "Remove" opens `<ConfirmDialog>`, not `window.confirm()`.
- [ ] The dialog message names the provider being removed.
- [ ] Confirming issues the DELETE; cancelling does not.
- [ ] The component is `client/src/components/ConfirmDialog.tsx` and is reusable.

---

## SUC-002: Student with non-League email appears in the Students filter

**Actor:** Admin  
**Trigger:** Admin selects the "Student" role lozenge on the Users page  
**Precondition:** A user row exists with `role === 'student'` and a primary email that does not end in `@students.jointheleague.org`

**Main flow:**
1. Admin opens /admin/users and clicks the "Student" lozenge.
2. The user with the non-League email appears in the filtered results.

**Acceptance criteria:**
- [ ] Student filter is based on `role === 'student'` only; email domain is not checked.
- [ ] A regression test covers a `role: 'student'` user with a `@civicknowledge.com` email appearing in the Student filter.

---

## SUC-003: Unified Users page renders all roles

**Actor:** Admin  
**Trigger:** Admin navigates to /admin/users  
**Precondition:** Users of roles admin, staff, and student exist in the system

**Main flow:**
1. Admin opens /admin/users. All active users are shown (default: "All" role lozenge selected).
2. Name, Email, Role, Accounts, and Joined columns are visible.
3. The Cohort column is absent.

**Acceptance criteria:**
- [ ] All active users display regardless of role when "All" is selected.
- [ ] Cohort column is not rendered.
- [ ] Role column renders the user's normalized role (admin / staff / student).

---

## SUC-004: Role lozenge and feature lozenge filter the Users table

**Actor:** Admin  
**Trigger:** Admin clicks a filter lozenge on the Users page  
**Precondition:** Unified Users page is displayed with the lozenge filter bar

**Main flow — Role filter (radio group, mutually exclusive):**
1. Admin clicks "Student". Only users with `role === 'student'` are shown.
2. Admin clicks "Staff". Role lozenge switches; only staff users shown.
3. Admin clicks "All". Full list restored.

**Main flow — Feature filter (multi-select toggle group, intersection semantics):**
1. Admin clicks "LLM Proxy". Only users with `llmProxyEnabled === true` are shown.
2. Admin also clicks "GitHub". Results narrow to users who have BOTH an active LLM proxy token AND a linked GitHub login.
3. Admin deactivates "LLM Proxy". Results show users with a GitHub login only.
4. Admin deactivates all toggles. Feature filter is inactive.

**Acceptance criteria:**
- [ ] Role lozenges: All | Staff | Admin | Student, exactly one active at a time.
- [ ] Feature toggles: Google | Pike 13 | GitHub | LLM Proxy | OAuth Client, each independently on/off.
- [ ] Multiple active feature toggles produce intersection results.
- [ ] No active feature toggles means no feature filter is applied.
- [ ] Role and feature filters stack (both apply simultaneously).
- [ ] Search bar further narrows results on top of active filters.
- [ ] Old `<FilterDropdown>` component is removed from the Users page.

---

## SUC-005: Sidebar shows only User Management and Groups under the User Management group

**Actor:** Admin  
**Trigger:** Admin views the sidebar  
**Precondition:** Post-consolidation deployment

**Main flow:**
1. Admin expands "User Management" in the sidebar.
2. Exactly two children appear: "User Management" (→ /admin/users) and "Groups" (→ /groups).
3. Students, Staff, LLM Proxy Users, and Cohorts entries are absent.

**Acceptance criteria:**
- [ ] User Management group has exactly two children: Users and Groups.
- [ ] Routes /users/students, /users/llm-proxy, /staff/directory, /cohorts, /cohorts/:id return 404 or redirect.
- [ ] Page components StudentAccountsPanel, LlmProxyUsersPanel, StaffDirectory, Cohorts, and CohortDetailPanel are deleted along with their test files.

---

## SUC-006: Bulk suspend and bulk revoke LLM proxy from the unified Users page

**Actor:** Admin  
**Trigger:** Admin selects rows on the unified Users page and uses the bulk action toolbar  
**Precondition:** At least one row is selected

**Main flow — Bulk suspend:**
1. Admin selects student rows and chooses "Suspend accounts" in the bulk toolbar.
2. `<ConfirmDialog>` appears. Admin confirms.
3. Workspace and Claude external accounts for selected users are suspended.

**Main flow — Bulk revoke LLM proxy:**
1. Admin selects rows containing users with active LLM proxy tokens and chooses "Revoke LLM Proxy" from the bulk toolbar.
2. `<ConfirmDialog>` appears. Admin confirms.
3. LLM proxy tokens for selected users are revoked.

**Acceptance criteria:**
- [ ] "Suspend accounts" bulk action exists on the Users page and calls the bulk-suspend endpoint.
- [ ] "Revoke LLM Proxy" bulk action is enabled only when the selection includes at least one user with `llmProxyEnabled === true`.
- [ ] Both actions use `<ConfirmDialog>` for confirmation, not `window.confirm()`.
- [ ] LlmProxyUsersPanel is not retained as a hidden page; bulk-revoke lives on the unified Users page.

---

## SUC-007: Google Workspace sync does not create new Cohort rows

**Actor:** System (scheduled or manually triggered sync)  
**Trigger:** Workspace sync runs  
**Precondition:** Sync code has been investigated and redirected if applicable

**Main flow:**
1. Sync runs. Student OUs are imported as Group rows (not Cohort rows) with matching names.
2. No new Cohort rows are created. Existing rows are left untouched (data migration deferred).
3. Imported student users carry `role: 'student'`.

**Alternate flow — Sync already writes Groups:**
Investigation confirms the sync does not write Cohort rows. No code change is needed; the ticket documents the finding.

**Acceptance criteria:**
- [ ] `workspace-sync.service.ts syncCohorts` method is investigated and its write target documented.
- [ ] If it writes Cohort rows, it is updated to write Group rows instead; cohort-related arguments are redirected to the GroupService.
- [ ] If no Cohort writes exist, a code comment confirms this and the ticket is closed.
