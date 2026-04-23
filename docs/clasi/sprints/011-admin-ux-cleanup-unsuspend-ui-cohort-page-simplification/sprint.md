---
id: "011"
title: "Admin UX cleanup — unsuspend UI + cohort page simplification"
status: roadmap
branch: sprint/011-admin-ux-cleanup-unsuspend-ui-cohort-page-simplification
use-cases: []
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 011: Admin UX cleanup — unsuspend UI + cohort page simplification

Short sprint. Two unrelated UX fixes on admin surfaces that both bite
every time an admin touches a suspended account or a cohort.

## Goals

1. Admin user detail page (`/users/:id`) surfaces the `suspended`
   state clearly and offers an **Unsuspend** action for each suspended
   ExternalAccount (workspace + claude).
2. Cohort detail page (`/cohorts/:id`) bulk-button row is trimmed and
   renamed to match how cohorts actually work.

## Scope

### In Scope

**Admin user page — suspended-state UI**

- Each workspace/claude ExternalAccount card shows its real status
  (including "suspended") instead of just hiding the Suspend button.
- An **Unsuspend** button appears when an account is suspended.
  Workspace unsuspension reuses the `googleClient.unsuspendUser` +
  flip-to-active path already used by the student-side re-activation
  request. Claude unsuspension: best-effort — re-invite if the
  original Anthropic id was an invite; otherwise surface a clear
  "not reversible; re-provision" affordance.

**Cohort page bulk buttons**

- Drop **Create League** (a student can't be in a cohort without a
  League account).
- Drop any **Create Log** buttons.
- Collapse per-type **Suspend League** / **Suspend Claude** into a
  single **Suspend All**. Ditto **Delete All**. Both operate across
  every live ExternalAccount for every cohort member.
- Keep **Create Claude seats** (still useful for members without a
  seat).

### Out of Scope

- App-level groups (Sprint 012).
- LLM proxy (Sprint 013).
- Deep claude reactivation semantics beyond "cancel invite and
  re-invite".

## TODO references

- `docs/clasi/todo/admin-user-page-unsuspend-ui.md`
- `docs/clasi/todo/cohort-page-simplify-bulk-buttons.md`

## Tickets

(To be populated during detail-phase planning.)
