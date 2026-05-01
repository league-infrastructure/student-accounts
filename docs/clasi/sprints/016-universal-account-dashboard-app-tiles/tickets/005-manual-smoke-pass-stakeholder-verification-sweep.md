---
id: "005"
title: "Manual smoke pass stakeholder verification sweep"
status: todo
use-cases: [SUC-016-001, SUC-016-002, SUC-016-003]
depends-on: ["001", "002", "003", "004"]
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke pass stakeholder verification sweep

## Description

Stakeholder owns this ticket. After tickets 001–004 are complete, walk through
the running app and confirm the new universal dashboard works for all three
roles.

## Smoke checklist

- [ ] `npm run dev` starts cleanly (server on 5201, client on 5173).
- [ ] Sign in as an **admin** (Google OAuth, email in `ADMIN_EMAILS`). After
      sign-in you land on `/account` (NOT `/`).
- [ ] On `/account` as admin, you see Apps tiles for User Management, Staff
      Directory, Cohorts, Groups. Profile/Identity zone may be hidden or
      minimal — that's fine.
- [ ] Click User Management tile → arrives at `/admin/users` and the existing
      admin UI renders.
- [ ] Sign out, sign in as a **staff** user (Google OAuth, `@jointheleague.org`,
      `/Staff` OU). Lands on `/account`. Sees Staff Directory + User Management
      tiles. Does NOT see Cohorts or Groups (admin-only).
- [ ] Sign out, sign in as a **student** (passphrase signup or returning
      student). Lands on `/account`. Sees existing Profile/Identity content
      AND the Apps zone. If the student has an LLM proxy token, the LLM Proxy
      tile is present; otherwise it is not.
- [ ] No console errors in the browser.
- [ ] No 5xx responses in the server logs.

If any item fails, file a bug fix as a follow-up ticket and return here when
green.

## Acceptance Criteria

- [ ] All checklist items pass.
- [ ] Stakeholder marks this ticket done.

## Testing

- **Existing tests to run**: none (manual).
- **New tests to write**: none.
- **Verification command**: visual / manual.
