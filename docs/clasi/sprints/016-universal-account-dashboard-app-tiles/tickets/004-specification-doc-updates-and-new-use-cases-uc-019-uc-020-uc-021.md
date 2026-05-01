---
id: "004"
title: "Specification doc updates and new use cases UC-019 UC-020 UC-021"
status: todo
use-cases: []
depends-on: []
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Specification doc updates and new use cases UC-019 UC-020 UC-021

## Description

The project's specification (`docs/clasi/design/specification.md`) currently
declares "no OAuth stored" as a non-goal — that line predates the SSO/OAuth
provider migration plan and is now wrong. Drop it.

Add three new use cases reflecting the new universal-dashboard model:

- **UC-019: User views personal dashboard.** Any authenticated user (student,
  staff, admin) lands on `/account` after sign-in and sees a list of
  sub-applications they have access to. The list is computed server-side
  from role + entitlements.
- **UC-020: Admin opens User Management sub-app.** From `/account`, an admin
  clicks the User Management tile and arrives at `/admin/users`, where they
  can manage student, staff, and admin accounts as before.
- **UC-021: Student opens LLM Proxy sub-app.** From `/account`, a student
  with an active LLM proxy token sees the LLM Proxy tile and uses it to
  reach their proxy configuration / token info.

**Modified files:**

- `docs/clasi/design/specification.md` — strike the "no OAuth stored" line.
  Add UC-019, UC-020, UC-021 in the use cases section, matching the format of
  existing UC-018 and earlier entries.

The implementer should also scan the spec doc for any other lines that
contradict the new direction (this app becoming an identity service / OAuth
provider over the next three sprints) and either fix them or flag them as
out-of-scope for this ticket.

## Acceptance Criteria

- [ ] The "no OAuth stored" line (or equivalent — search for "OAuth" and
      "stored" in the spec) is removed from `specification.md`.
- [ ] UC-019, UC-020, UC-021 added with the same structure as existing UCs.
- [ ] Any directly contradicted lines are either fixed or noted in a TODO
      paragraph at the top of the spec for sprint 017+ to address.
- [ ] No code changes required by this ticket.

## Testing

- **Existing tests to run**: none (docs only).
- **New tests to write**: none.
- **Verification command**: visual review of the diff.
