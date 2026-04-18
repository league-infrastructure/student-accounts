---
id: '001'
title: Strip backend domain layer
status: done
use-cases: []
depends-on: []
github-issue: ''
todo: plan-revert-template-app-to-simple-two-button-counter-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 001 — Strip backend domain layer

## Description

Remove all LEAGUEhub domain code from the server — routes, services, admin routes, and
domain-specific middleware that were introduced in Sprint 017. This establishes the clean
backend base that tickets 003, 004, and 007 all depend on.

Do NOT roll back via git. Docker and CLASI scaffolding commits must be preserved. Delete
files surgically and fix up import references in the files that remain.

First, read `routes/github.ts` and `routes/integrations.ts` to confirm they are
infrastructure (not domain) before deciding whether to keep or delete them.

## Files to Delete

**Route files:**
- `server/src/routes/instructor.ts`
- `server/src/routes/reviews.ts`
- `server/src/routes/templates.ts`
- `server/src/routes/checkins.ts`
- `server/src/routes/feedback.ts`
- `server/src/routes/pike13.ts`

**Admin route files:**
- `server/src/routes/admin/instructors.ts`
- `server/src/routes/admin/compliance.ts`
- `server/src/routes/admin/volunteer-hours.ts`
- `server/src/routes/admin/admin-feedback.ts`
- `server/src/routes/admin/notifications.ts`

**Service files:**
- `server/src/services/checkin.service.ts`
- `server/src/services/compliance.service.ts`
- `server/src/services/email.service.ts`
- `server/src/services/feedback.service.ts`
- `server/src/services/instructor.service.ts`
- `server/src/services/notification.service.ts`
- `server/src/services/pike13-sync.service.ts`
- `server/src/services/review.service.ts`
- `server/src/services/student.service.ts`
- `server/src/services/template.service.ts`
- `server/src/services/volunteer.service.ts`

**Middleware:**
- `server/src/middleware/requireInstructor.ts`

## Files to Modify

**`server/src/app.ts`:**
- Remove all imports and `app.use()` registrations for deleted route files.
- Keep infrastructure routes: auth, health, admin/* (generic panels), github, integrations.
- Do not add `countersRouter` yet (ticket 003) or `impersonateMiddleware` yet (ticket 007).

**`server/src/services/service.registry.ts`:**
- Remove registrations for all deleted services.
- Keep: UserService, PermissionsService, SessionService, SchedulerService,
  BackupService, DbIntrospector, LogBuffer, PrismaSessionStore.

**`server/src/routes/admin/index.ts`:**
- Remove imports and mounts for deleted admin routes.

**`server/prisma/schema.prisma`:**
- Remove models: `Instructor`, `Student`, `InstructorStudent`, `MonthlyReview`,
  `ReviewTemplate`, `ServiceFeedback`, `Pike13Token`, `TaCheckin`, `AdminNotification`,
  `VolunteerHour`, `StudentAttendance`, `VolunteerSchedule`, `VolunteerEventSchedule`,
  `Pike13AdminToken`, `AdminSetting`.
- Remove enum: `ReviewStatus`.
- Remove relation fields `instructors` and `notifications` from `User` model.
- Do not add `Counter` yet — that is ticket 003.

**`server/src/routes/auth.ts`:**
- Remove Pike13/Google/GitHub OAuth strategy registrations from Passport.
- Keep: `express-session`, `passport.initialize()`, `passport.session()`,
  `serializeUser`, `deserializeUser` (User-only — remove Instructor record loading).
- Remove the Instructor record join from `deserializeUser`.

**`server/package.json`:**
- Verify no remaining imports of `@sendgrid/mail` or `groq-sdk` in kept files, then
  remove both from dependencies. Run `npm install` to update the lockfile.

**Tests:**
- Delete test files that exclusively cover deleted features.
- Do not delete shared test utilities or tests for kept features.

## Acceptance Criteria

- [x] All listed route, service, and middleware files deleted
- [x] `app.ts` has no import or `app.use()` call referencing deleted routes
- [x] `service.registry.ts` has no registration referencing deleted services
- [x] `routes/admin/index.ts` mounts only infrastructure admin routes
- [x] `schema.prisma` contains no LEAGUEhub domain models or `ReviewStatus` enum
- [x] `User` model has no `instructors` or `notifications` relation fields
- [x] Passport `deserializeUser` loads only the `User` record (no Instructor join)
- [x] `@sendgrid/mail` and `groq-sdk` removed from `package.json`
- [x] `server/src` TypeScript compiles without errors (`npm run build` or `tsc --noEmit`)
- [x] `npm run test:server` passes (deleted-feature tests also deleted)
- [x] `grep -ri "from.*instructor\|from.*pike13\|from.*volunteer\|from.*compliance" server/src` returns zero hits

## Implementation Plan

1. Read `routes/github.ts` and `routes/integrations.ts` to confirm infrastructure status.
2. Delete all listed route files, service files, and `requireInstructor.ts`.
3. Edit `app.ts` — remove dead imports and `app.use()` calls.
4. Edit `service.registry.ts` — remove dead service registrations.
5. Edit `routes/admin/index.ts` — remove dead admin route mounts.
6. Edit `schema.prisma` — remove domain models, enum, and User relation fields.
7. Edit `routes/auth.ts` — remove OAuth strategy registrations; simplify `deserializeUser`.
8. Run grep to find any remaining references to deleted files; fix them.
9. Verify `@sendgrid/mail` and `groq-sdk` are not imported in any kept file; remove from `package.json`; run `npm install`.
10. Run `npm run build` (or `tsc --noEmit`) to confirm zero TypeScript errors.
11. Run `npm run test:server`.

## Testing

- **Existing tests to run**: `npm run test:server` — all tests for infrastructure features must pass.
- **New tests to write**: None for this ticket (deletion-only work).
- **Verification command**: `npm run build && npm run test:server`
