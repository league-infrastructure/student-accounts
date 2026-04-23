---
id: "012"
title: "App-level groups — multi-membership, search, bulk provisioning"
status: roadmap
branch: sprint/012-app-level-groups-multi-membership-search-bulk-provisioning
use-cases: []
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 012: App-level groups

Introduce a second user-grouping mechanism that lives entirely in this
application — independent of Google Workspace OUs. Cohort stays as the
OU-anchored 1:1 grouping; **Group** is a many-to-many layer on top
that we use for arbitrary sets and bulk operations.

## Goals

1. Users can belong to multiple Groups.
2. Admins can create/list/rename/delete Groups, manage membership
   from both the group detail page and the user detail page.
3. Groups are the unit for bulk provisioning — the same operations
   we already run per cohort can be run for any group.

## Scope

### In Scope

**Model**

- New `Group` entity: id, name, optional description, timestamps.
- Many-to-many `User ↔ Group` join table.
- No FK to Cohort; no FK to any Google OU.
- Audit events for create / delete / add-member / remove-member.

**Admin UI**

- `/groups` list page: all groups with member counts + Create button.
- `/groups/:id` detail page: member table, search box (matches
  display_name, primary_email, any Login.provider_email /
  provider_username), add-from-search, per-row Remove.
- User detail page (`/users/:id`): new "Groups" section listing
  membership with Add + Remove.

**Bulk provisioning on the group detail page**

- Bulk-create League email accounts for every eligible member.
- Bulk-invite Claude seats for every eligible member.
- Bulk-suspend / bulk-remove the same, following the
  succeeded/failed-with-reasons pattern used by cohort bulk ops.
- Future bulk actions (LLM proxy token toggle, Pike13, etc.) slot
  into this page.

### Out of Scope

- Syncing groups to Google Groups (opt-in, later sprint).
- LLM proxy access toggle — comes in Sprint 013, which uses this
  group surface.
- Pike13 bulk actions (separate sprint when those write paths land).

## Open questions to resolve in detail planning

- Naming: "Group" vs something more specific to avoid confusion with
  Google Groups — e.g. "AppGroup", "Team", "Roster". Decide before
  schema work.
- Who can create/manage groups — admins only for now?
- Does a group own any configuration (default cohort, default LLM
  quota) or is it purely a membership bucket?

## TODO references

- `docs/clasi/todo/app-level-groups-for-bulk-provisioning.md`

## Tickets

(To be populated during detail-phase planning.)
