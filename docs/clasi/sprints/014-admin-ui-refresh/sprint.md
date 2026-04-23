---
id: "014"
title: "Admin UI Refresh"
status: planning
branch: sprint/014-admin-ui-refresh
use-cases: []
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 014: Admin UI Refresh

## Goals

Reduce clutter in the admin UI, improve the group management workflow with per-row selection and bulk actions, and remove unused features (Claude sync, Invite Claude, Delete All buttons). Ensure the admin experience is focused on core tasks: managing users, groups, and cohorts.

## Problem

The admin UI has accumulated several issues:
- Navigation is cluttered with less-used links (Account, Merge Queue) mixed with primary workflow items
- Dashboard shows a CohortsWidget that duplicates the Cohorts page
- Groups page lacks a way to select multiple members for bulk operations; row-level remove button is rarely used
- SyncPanel includes Claude sync controls that are no longer relevant to the platform
- Missing visibility into LLM proxy status for members in a group

## Solution

Perform surgical UI updates with minimal backend changes:
1. Reorder navigation to show primary workflows first (Dashboard → Users → Groups → Cohorts → Sync → Requests)
2. Clean dashboard: move UserCountsWidget to top, remove CohortsWidget
3. Add student count column to Cohorts list (backend returns count)
4. Redesign GroupDetailPanel with click-to-edit names, checkboxes for row selection, and smart button set that counts effective targets
5. Remove Anthropic/Claude card from SyncPanel
6. Add LLM proxy status column to group members table
7. Backend: add optional userIds filter to bulk-action endpoints, expose member counts and LLM proxy status

## Success Criteria

- Admin navigation is clean: Dashboard → Users → Groups → Cohorts → Sync → Requests; no Account or Merge Queue links
- Dashboard shows UserCounts first, no CohortsWidget
- Cohorts list has a Students column with correct member counts
- GroupDetailPanel: group name is click-to-edit (no Edit button), row checkboxes work, button set counts match selection state, LLM Proxy column visible
- SyncPanel shows only Pike13 and Google Workspace sections
- All changes pass tests (unit and integration)
- Manual verification checklist passes

## Scope

### In Scope

- AppLayout.tsx: Navigation reordering (remove Account, Merge Queue)
- Dashboard.tsx: Widget reordering (UserCounts first), remove CohortsWidget
- Cohorts.tsx: Add Students column showing member count
- SyncPanel.tsx: Remove Anthropic/Claude section
- GroupDetailPanel.tsx: Click-to-edit group name, row selection checkboxes, new button set, LLM Proxy column
- Backend cohorts endpoint: add _count.users to response
- Backend group members endpoint: add llmProxyToken status per member
- Backend bulk-action endpoints: accept optional userIds filter

### Out of Scope

- Changes to other pages (Users, Sync Pike13/Google sections, Requests)
- New features (future group permissions, role-based actions, etc.)
- Database schema changes
- Authentication or access control changes

## Test Strategy

1. **Unit Tests**: Button count logic (Create League, Remove League, Suspend, Grant/Revoke LLM Proxy) with various member states and selection scenarios
2. **Integration Tests**: Bulk-action endpoints with and without userIds filter; verify correct members are affected
3. **Component Tests**: Click-to-edit flow (click → edit → save/cancel), row selection indeterminate state
4. **Manual Verification**:
   - Log in as admin; verify navigation order
   - Dashboard loads, shows UserCounts first, no CohortsWidget, no 404 errors
   - Cohorts page shows Students column with correct counts
   - Groups detail: name is clickable, checkboxes work, buttons update counts, LLM Proxy column visible
   - SyncPanel shows only Pike13 and Google Workspace

## Architecture Notes

- **Selection State**: Local to GroupDetailPanel; no server-side group member selection state
- **Button Semantics**: Counts reflect effective selection (no selection = all members; any selection = only selected)
- **Response Shape**: Backend adds fields, no breaking changes (backward compatible)
- **UI Library**: Uses existing shadcn/ui Button component (no new dependencies)
- **LLM Proxy Status**: Read-only display (no new mutations or provisioning logic)
- **CohortsWidget Removal**: Complete deletion; verify no lingering API calls

## GitHub Issues

(GitHub issues linked to this sprint's tickets. Format: `owner/repo#N`.)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Cohorts endpoint — add member count | — | 1 |
| 002 | Group members endpoint — add LLM proxy status | — | 1 |
| 003 | Group bulk-action routes — accept userIds filter | — | 1 |
| 004 | AppLayout — navigation reordering | — | 2 |
| 005 | Dashboard — widget cleanup | — | 3 |
| 006 | SyncPanel — remove Claude section | — | 3 |
| 007 | GroupDetailPanel — click-to-edit name, row selection | 002 | 4 |
| 008 | GroupDetailPanel — LLM proxy column, button redesign | 002, 003 | 4 |
| 009 | Cohorts — students count column | 001 | 5 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
