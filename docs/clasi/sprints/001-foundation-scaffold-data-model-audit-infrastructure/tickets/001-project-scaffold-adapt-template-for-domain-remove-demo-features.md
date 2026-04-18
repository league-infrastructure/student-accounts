---
id: '001'
title: "Project scaffold \u2014 adapt template for domain, remove demo features"
status: in-progress
use-cases:
- SUC-003
- SUC-005
depends-on: []
github-issue: ''
todo: ''
---

# Project scaffold — adapt template for domain, remove demo features

## Description

The repository starts from the Docker Node template, which includes demo
features (counters, demo login, Pike13 stub route, integrations stub, GitHub
auth stub) that do not belong in this application. This ticket removes or
stubs those demo features and establishes the server layout described in the
architecture, making the codebase ready for domain work in subsequent
tickets.

This ticket is intentionally narrow: no schema changes (T003–T005), no new
domain services (T006–T008). The goal is a compiling, passing server with
only the infrastructure that this application actually needs.

## Acceptance Criteria

- [ ] `server/src/routes/counters.ts` is deleted; the `/api/counters` route
      is removed from `app.ts`.
- [ ] `server/src/services/counter.service.ts` is deleted and removed from
      `ServiceRegistry` (property, import, and instantiation).
- [ ] The demo login route (`POST /api/auth/demo-login`) is removed from
      `routes/auth.ts`. The file remains as a skeleton with a comment noting
      OAuth strategies land in a later sprint. `passport.serializeUser` /
      `passport.deserializeUser` stubs remain.
- [ ] `server/src/routes/pike13.ts`, `server/src/routes/integrations.ts`,
      and `server/src/routes/github.ts` are deleted; their `app.use()`
      registrations are removed from `app.ts`.
- [ ] `server/src/errors.ts` exports: `AppError` (base, with `statusCode`),
      `NotFoundError` (404), `ConflictError` (409), `ValidationError` (422),
      `ForbiddenError` (403). Existing `NotFoundError` is retained and any
      missing classes added.
- [ ] `server/src/contracts/index.ts` exports `ServiceSource` as
      `'UI' | 'API' | 'MCP' | 'SYSTEM'` (already present; verify no change
      needed).
- [ ] `server/src/app.ts` compiles cleanly with no references to removed
      modules.
- [ ] `npm run build` (TypeScript compile) exits with code 0, no errors.
- [ ] `npm run test:server` passes. Existing tests for removed routes
      (counter tests, demo-login tests, pike13 tests, github tests,
      integrations tests) are deleted alongside their route files.

## Implementation Plan

### Approach

Delete files and their references; do not refactor what remains. Preserve
all infrastructure: `SessionService`, `BackupService`, `SchedulerService`,
pino logger, session middleware, passport scaffolding, `attachServices`
middleware, `errorHandler`. The only `ServiceRegistry` change is removing
counter references.

### Files to Delete

- `server/src/routes/counters.ts`
- `server/src/routes/pike13.ts`
- `server/src/routes/integrations.ts`
- `server/src/routes/github.ts`
- `server/src/services/counter.service.ts`
- Test files for the deleted routes (counters.test.ts, pike13.test.ts,
  integrations.test.ts, github.test.ts, auth-demo-login.test.ts,
  auth-oauth.test.ts if it only tests demo-login)

### Files to Modify

- `server/src/app.ts` — remove imports and `app.use()` for deleted routes.
- `server/src/services/service.registry.ts` — remove `CounterService`.
- `server/src/errors.ts` — add missing error classes.
- `server/src/routes/auth.ts` — remove demo-login handler; add comment.

### Testing Plan

Run `npm run test:server` after each deletion to catch broken imports early.
Run `npm run build` at the end. No new tests in this ticket.

### Documentation Updates

None. The architecture document describes the target state.
