---
id: 018
title: Template Reset, Admin Impersonation, and Docs Migration
status: done
branch: sprint/018-template-reset-admin-impersonation-and-docs-migration
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
- SUC-008
- SUC-009
- SUC-010
- SUC-011
- SUC-012
todos:
- docs/clasi/todo/plan-revert-template-app-to-simple-two-button-counter-demo.md
- docs/clasi/todo/plan-admin-user-impersonation.md
- docs/clasi/todo/migrate-docs-to-claude-instructions.md
- docs/clasi/todo/plan-social-login-account-linking-for-the-template-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 018: Template Reset, Admin Impersonation, and Docs Migration

## Goals

1. Strip the LEAGUEhub student-progress-report domain from the codebase and restore the
   template to a minimal, reusable starting point backed by a simple two-button counter demo.
2. Wire up the existing impersonation middleware and surface it through API endpoints and
   admin UI so admins can debug issues as other users.
3. Migrate the five agent-context docs from `docs/` into `.claude/rules/` so they are
   auto-loaded by the rules system.
4. Re-introduce GitHub, Google, and Pike 13 OAuth flows (stripped in goal 1) as
   configuration-gated social login, with account linking and unlink support via the
   Account page. (Added mid-sprint — see `architecture-update-social-login.md`.)

## Problem

Sprint 017 replaced the template's counter demo with the LEAGUEhub domain (Instructor,
Student, Review, Template, Checkin, Feedback, Pike13, VolunteerHour — 15+ models, 11
services, 6 route files, 10+ pages). This makes the template unusable as a generic starter.
Separately, the impersonation middleware has been written but never wired up, and several
reference docs live in `docs/` where agents do not auto-load them.

## Solution

**Phase 1 — Template reset (largest blast radius; establishes clean base):**
Surgically delete all LEAGUEhub domain files (routes, services, pages, admin panels, Prisma
models) from the current branch. Do NOT roll back via git — the Docker and CLASI scaffolding
commits must be preserved. Add the Counter model + seed, counter routes, a new HomePage,
and a demo-login endpoint backed by two hardcoded credential pairs. Tighten the app shell
(AppLayout sidebar/topbar), strip Pike13 OAuth, and update README + docs/template-spec.md
to describe the template as a counter demo.

**Phase 2 — Admin impersonation (applied on the clean post-reset codebase):**
Import and mount `impersonate.ts` middleware in `app.ts`. Update `requireAdmin` to check the
real admin's role during impersonation. Add two API endpoints (`POST /api/admin/users/:id/impersonate`,
`POST /api/admin/stop-impersonating`). Extend `/api/auth/me` with impersonation fields.
Add an Impersonate button to UsersPanel and show a banner + "Stop impersonating" in the
account dropdown.

**Phase 3 — Docs migration (independent once reset is done):**
Add YAML front matter with `paths:` to each of the five docs, copy them to `.claude/rules/`,
delete the originals from `docs/`, and update CLAUDE.md. docs/template-spec.md is rewritten
in Phase 1; Phase 3 migrates the post-rewrite version.

## Success Criteria

- `docker compose up` brings the app up cleanly.
- `/login` shows a pre-filled username/password form (`user`/`pass`).
- `user`/`pass` logs in as USER role and shows the counter homepage.
- Clicking each counter button increments the displayed value persistently.
- `admin`/`admin` logs in as ADMIN role; Admin and Configuration links appear in sidebar.
- `grep -ri "pike13|instructor|student|review|checkin|leaguehub" client/src server/src` returns
  zero domain hits.
- Admin can click "Impersonate" on any user in UsersPanel; app switches identity.
- Impersonation banner is visible; "Stop impersonating" returns to admin identity.
- Admin routes remain accessible during impersonation.
- The five docs (`api-integrations`, `deployment`, `secrets`, `setup`, `template-spec`) exist
  in `.claude/rules/` with front matter and are absent from `docs/`.
- `CLAUDE.md` no longer references the old `docs/` paths for migrated files.
- All remaining tests pass.

## Scope

### In Scope

**Template reset — delete:**
- Frontend pages: DashboardPage, ReviewListPage, ReviewEditorPage, TemplateListPage,
  TemplateEditorPage, CheckinPage, FeedbackPage, PendingActivationPage, LoginPage (replaced)
- Frontend components: InstructorLayout, MonthPicker (if domain-specific)
- Backend routes: `instructor.ts`, `reviews.ts`, `templates.ts`, `checkins.ts`,
  `feedback.ts`, `pike13.ts`
- Backend services: all LEAGUEhub domain services (instructor, student, review, template,
  checkin, feedback, pike13-sync, notification, volunteer, compliance, email)
- Admin panels: InstructorListPanel, CompliancePanel, VolunteerHoursPanel, AdminFeedbackPanel
- Admin routes: `instructors.ts`, `compliance.ts`, `volunteer-hours.ts`, `admin-feedback.ts`,
  `notifications.ts`
- Prisma models: Instructor, Student, InstructorStudent, MonthlyReview, ReviewTemplate,
  ServiceFeedback, Pike13Token, TaCheckin, AdminNotification, VolunteerHour, StudentAttendance,
  VolunteerSchedule, VolunteerEventSchedule, Pike13AdminToken, AdminSetting, ReviewStatus enum
- Passport Google/GitHub/Pike13 OAuth strategies (keep express-session + Passport core)
- Server dependencies: `@sendgrid/mail`, `groq-sdk` (if no longer needed)
- Middleware: `requireInstructor.ts`
- Tests that exclusively cover deleted features

**Template reset — add:**
- Prisma `Counter` model (id, name, value, updatedAt) with seed for `alpha` and `beta`
- `GET /api/counters` and `POST /api/counters/:name/increment` routes
- `POST /api/auth/demo-login` endpoint (hardcoded credential pairs)
- `HomePage.tsx` — two counters, two buttons, React Query
- New `LoginPage.tsx` — username/password form pre-filled with `user`/`pass`
- AppLayout sidebar tightened: MAIN (Home), BOTTOM (MCP Setup, About), ADMIN_ONLY
  (Configuration → /admin/config, Admin)
- README and docs/template-spec.md updated to describe counter demo

**Admin impersonation:**
- Mount `impersonateMiddleware` in `app.ts` after `passport.session()`
- Update `requireAdmin.ts` to check real admin role during impersonation
- Add endpoints: `POST /api/admin/users/:id/impersonate`,
  `POST /api/admin/stop-impersonating`
- Extend `/api/auth/me` with `impersonating` and `realAdmin` fields
- UsersPanel: "Impersonate" button per user row (skip own row)
- AppLayout account dropdown: banner + "Stop impersonating" when impersonating

**Docs migration:**
- Add `paths:` YAML front matter to api-integrations, deployment, secrets, setup,
  template-spec docs
- Move all five to `.claude/rules/`
- Remove originals from `docs/`
- Update CLAUDE.md references

### Out of Scope

- Auditing/pruning admin section content (separate future sprint)
- New admin features beyond impersonation
- Production deployment changes
- CI/CD adjustments
- E2E / Playwright tests
- Any domain other than the counter demo

## Test Strategy

- Server unit tests: counter increment idempotency, demo-login 401 on bad credentials,
  impersonation session fields set/cleared correctly
- Manual smoke tests: login form, counter increment persistence, admin impersonation flow,
  stop-impersonating return, admin routes accessible during impersonation
- Grep verification: no domain-specific identifiers remain in client/src or server/src
- Docker build verification: `docker compose build` succeeds

## Architecture Notes

- Strip-in-place on current branch — no git rollback. Valuable Docker/CLASI commits are
  preserved by surgical deletion only.
- Counter feature intentionally minimal: no auth gate on increment (any logged-in user),
  auto-create row on first increment.
- Demo login: finds-or-creates User record by email (`user@demo.local`, `admin@demo.local`).
  Passport local serialization replaces Pike13 OAuth strategy.
- Impersonation state lives in `req.session` (`impersonatingUserId`, `realAdminId`).
  `impersonate.ts` middleware already reads these fields — just needs mounting.
- Docs migration uses `paths:` YAML front matter to scope rule auto-loading; broad scopes
  (e.g. `**/*`) are appropriate for reference docs.

## GitHub Issues

None.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Strip backend domain layer | — | 1 |
| 002 | Strip frontend domain layer | — | 1 |
| 003 | Add Counter backend | 001 | 2 |
| 004 | Add demo login backend | 001 | 2 |
| 005 | Add counter homepage + new login page | 002, 003, 004 | 3 |
| 006 | Tighten app shell | 002 | 2 |
| 007 | Wire impersonation middleware + requireAdmin | 001 | 2 |
| 008 | Add impersonation API endpoints | 007 | 3 |
| 009 | Add impersonation admin UI | 005, 008 | 4 |
| 010 | Migrate docs to .claude/rules | 005, 006 | 4 |
| 011 | Re-add GitHub + Google Passport strategies | — | 2 |
| 012 | Recreate Pike 13 hand-rolled OAuth flow | 011 | 3 |
| 013 | Extend auth/me with linkedProviders + unlink endpoint | 011 | 3 |
| 014 | Add provider buttons to LoginPage | 011, 013 | 4 |
| 015 | Add Sign-in methods section to Account page | 011, 012, 013, 014 | 5 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).

Note: Tickets 011-015 form an independent work stream that can proceed in parallel with
ticket 010. They have no dependency on 010, and 010 has no dependency on them.
