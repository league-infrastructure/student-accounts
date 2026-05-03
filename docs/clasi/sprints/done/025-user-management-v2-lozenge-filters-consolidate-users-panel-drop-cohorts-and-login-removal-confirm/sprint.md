---
id: '025'
title: User Management v2 - lozenge filters consolidate Users panel drop Cohorts and
  login removal confirm
status: done
branch: sprint/025-user-management-v2-lozenge-filters-consolidate-users-panel-drop-cohorts-and-login-removal-confirm
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
todo: docs/clasi/todo/backlog-user-management-v2-account-login-ux-cohort-drop.md
---

# Sprint 025: User Management v2

## Goals

1. Require confirmation before removing a login provider on the Account page (custom in-page modal, not `window.confirm()`).
2. Fix bug: students with non-League email addresses are invisible in the Students list due to email-domain filtering.
3. Consolidate the separate Users / Students / Staff / LLM Proxy Users panels into one unified Users page with lozenge filters (role radio + feature multi-select).
4. Shrink the sidebar User Management group to exactly two entries: User Management and Groups. Delete all now-orphaned pages and routes.
5. Investigate and, if applicable, redirect Google Workspace sync cohort-writes to Group-writes. Defer the data migration of existing Cohort rows.

## Problem

Post-sprint-024 the User Management section has six sidebar items for what is conceptually one resource (users) plus one supporting concept (groups). The Students list silently drops any student whose email is not on the League student domain — a data correctness bug. The Account page's "Remove" button for login providers fires without confirmation, causing accidental unlinking. The Cohorts concept is being retired as a first-class navigation concept; the sidebar and pages must stop surfacing it.

## Solution

- A reusable `<ConfirmDialog>` component handles all destructive confirmations this sprint and beyond.
- The student filter bug is fixed by switching to `role === 'student'` as the sole predicate.
- The unified `AdminUsersPanel` gains two filter bars: a radio role lozenge (All | Staff | Admin | Student) and a multi-select feature lozenge (Google | Pike 13 | GitHub | LLM Proxy | OAuth Client). The backend `/api/admin/users` response is extended with `llmProxyEnabled` and `oauthClientCount` to support the new lozenges.
- Bulk-suspend (from StudentAccountsPanel) and bulk-revoke LLM proxy (from LlmProxyUsersPanel) are folded into the unified Users page bulk toolbar. All orphaned page components and routes are deleted.
- Sidebar User Management group is pruned to two children.
- The sync investigation is a bounded research ticket: if `syncCohorts` writes Cohort rows, redirect to Group writes; if not, document the finding and close.

## Success Criteria

- Clicking "Remove" on a login provider shows a styled confirm dialog, not a browser alert.
- A student with `eric@civicknowledge.com` appears in the Student lozenge view.
- All users (admin, staff, student) appear in the unified Users page under "All".
- Role and feature lozenges filter correctly; multi-feature toggles produce intersection results.
- Sidebar User Management group has exactly two children; orphaned routes 404.
- Sync either redirects cohort-writes to Groups or the investigation confirms no change is needed.

## Scope

### In Scope

- `<ConfirmDialog>` component + Account.tsx integration (item A)
- Student email-domain bug fix + regression test (item B)
- `/api/admin/users` response extended with `llmProxyEnabled` and `oauthClientCount` (item C backend)
- Unified Users page lozenge filters + bulk-suspend + bulk-revoke LLM proxy (item C client)
- Sidebar shrink + delete StudentAccountsPanel, LlmProxyUsersPanel, StaffDirectory, Cohorts, CohortDetailPanel, and their routes and tests
- Google Workspace sync investigation and conditional redirect (item D, deferred-migration variant)
- Manual smoke-test ticket for stakeholder verification

### Out of Scope

- Data migration of existing Cohort rows to Group membership rows (deferred sprint)
- Deletion of the Cohort Prisma model or database table
- Pagination of the Users list (deferred)
- Shared `<DataTable>` abstraction (deferred)

## Test Strategy

- Regression test (client unit test): a `role: 'student'` user with a non-League email must appear under the Student lozenge filter.
- Unit tests for the lozenge filter logic covering role filter, each feature toggle, and multi-toggle intersection.
- Backend test: `GET /api/admin/users` response includes `llmProxyEnabled` (boolean) and `oauthClientCount` (number) per user.
- Smoke test: stakeholder manually verifies the confirm dialog, student visibility, lozenge filters, sidebar shape, and bulk actions.

## Architecture Notes

See `architecture-update.md` for full detail. Key decisions:
- `<ConfirmDialog>` is a new reusable component at `client/src/components/ConfirmDialog.tsx`.
- The existing `<FilterDropdown>` in AdminUsersPanel is replaced by two lozenge filter components.
- `llmProxyEnabled` is derived server-side from an active (non-expired, non-revoked) LlmProxyToken row. `oauthClientCount` is a `_count` aggregate on the `oauth_clients_created` relation.
- No cohort column on the unified Users page.
- No Prisma schema changes this sprint.

## GitHub Issues

None.

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | ConfirmDialog component + Account.tsx login removal | — | 1 |
| 002 | Fix student email-domain bug + regression test | — | 1 |
| 003 | Backend: extend /api/admin/users with llmProxyEnabled + oauthClientCount | — | 1 |
| 004 | Investigate Google sync cohort-writes; redirect to Group-writes if applicable | — | 1 |
| 005 | Client: unified Users page lozenge filters and bulk actions | 003 | 2 |
| 006 | Sidebar shrink and delete orphaned pages and routes | 005 | 3 |
| 007 | Manual smoke test: stakeholder verification | 001, 002, 004, 005, 006 | 4 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
