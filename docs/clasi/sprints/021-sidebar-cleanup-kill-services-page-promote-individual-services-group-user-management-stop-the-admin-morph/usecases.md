---
sprint: "021"
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Use Cases — Sprint 021

## SUC-001: Stable sidebar across all routes

**Actor:** Any authenticated user (student, staff, admin)

**Goal:** Navigate the application without the sidebar changing shape depending
on the current URL.

**Preconditions:** User is authenticated and on any page under `AppLayout`.

**Main flow:**
1. User navigates to a page under `/admin/*` (e.g., `/admin/env`).
2. The sidebar retains the same items and groups it showed before navigation.
3. No "Back to App" link appears; no ADMIN_NAV swaps in.
4. User navigates back to a non-admin page.
5. Sidebar is unchanged.

**Outcome:** The sidebar nav is identical regardless of the current route.

**Covers tickets:** 001, 006, 007

---

## SUC-002: Claude Code as standalone sidebar page (entitlement-gated)

**Actor:** Student with an active or pending `claude` ExternalAccount

**Goal:** Access Claude Code onboarding instructions from a dedicated sidebar item.

**Preconditions:** User is authenticated. User's account has a `claude`
ExternalAccount (active or pending).

**Main flow:**
1. User opens the sidebar and sees "Claude Code" listed.
2. User clicks "Claude Code" and is taken to `/claude-code`.
3. Page renders the Claude Code onboarding instructions (install + auth + verify
   steps) appropriate for their `claude` ExternalAccount status.

**Alternate flow (not entitled):**
- User has no `claude` ExternalAccount.
- "Claude Code" does not appear in the sidebar.

**Outcome:** The Claude Code page is accessible only to entitled users; the
sidebar item appears only when the entitlement predicate is true.

**Covers tickets:** 002, 006, 007

---

## SUC-003: LLM Proxy as standalone sidebar page (entitlement-gated)

**Actor:** Student with `llmProxyEnabled === true`

**Goal:** Access LLM Proxy token details and usage from a dedicated sidebar item.

**Preconditions:** User is authenticated. `account.profile.llmProxyEnabled` is
`true`.

**Main flow:**
1. User opens the sidebar and sees "LLM Proxy" listed.
2. User clicks "LLM Proxy" and is taken to `/llm-proxy`.
3. Page renders the LLM Proxy card showing endpoint, token, quota bar, and
   code snippet.

**Alternate flow (not entitled):**
- `llmProxyEnabled` is `false` or absent.
- "LLM Proxy" does not appear in the sidebar.

**Outcome:** The LLM Proxy page is accessible only to enabled users; the sidebar
item appears only when `llmProxyEnabled` is true.

**Covers tickets:** 002, 006, 007

---

## SUC-004: User Management collapsible group expanding to Staff Directory

**Actor:** Staff or admin user

**Goal:** Access all user-related pages from a single collapsible sidebar group
that opens to a sensible default.

**Preconditions:** User is authenticated with `staff` or `admin` role.

**Main flow:**
1. User sees "User Management" in the sidebar (collapsed or expanded).
2. User clicks the "User Management" group header.
3. Group expands to show child items: Staff Directory (default), Users, League
   Students, LLM Proxy Users, Cohorts, Groups.
4. Navigation lands on Staff Directory (`/staff/directory`).
5. Child items that require `admin` role (Users, League Students, LLM Proxy
   Users, Cohorts, Groups) are hidden for `staff`-only users.

**Outcome:** User-management pages are grouped; clicking the header navigates
to Staff Directory; admin-only children are gated by role.

**Covers tickets:** 001, 005, 006, 007

---

## SUC-005: Consolidated users page — /users and /admin/users resolve to one canonical route

**Actor:** Admin user

**Goal:** Navigate to the users list from either the old `/users` route or the
new sidebar entry without landing on different pages.

**Preconditions:** User is authenticated with `admin` role.

**Main flow:**
1. User navigates to `/users` (old route from `ADMIN_WORKFLOW_NAV`).
2. Request resolves to the canonical users page (whichever panel is retained).
3. User navigates via the sidebar "Users" item inside User Management group.
4. Same canonical page is shown.
5. The deprecated route redirects to the canonical route.

**Outcome:** One users page, one route; the other redirects; sidebar always
links to the canonical path.

**Covers tickets:** 005, 006, 007
