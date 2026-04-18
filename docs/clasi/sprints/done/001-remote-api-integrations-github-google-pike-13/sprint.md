---
id: '001'
title: Remote API Integrations (GitHub, Google, Pike 13)
status: done
branch: sprint/001-remote-api-integrations-github-google-pike-13
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
---

# Sprint 001: Remote API Integrations (GitHub, Google, Pike 13)

## Goals

Add template-level infrastructure for connecting to three external services
— GitHub (OAuth), Google (OAuth), and Pike 13 (API). Provide a single-file
example application that demonstrates all three integrations and is trivially
removable when the developer builds their real app.

## Problem

The template currently has no authentication, no session management, and no
examples of calling external APIs. Every new project built from this template
will need at least one OAuth provider and likely one or more third-party API
integrations. Without template-level infrastructure, each developer reinvents
these patterns from scratch.

## Solution

1. Add Express session + Passport.js infrastructure (permanent)
2. Add GitHub and Google OAuth strategies with auth routes (permanent)
3. Add Pike 13 API proxy routes (permanent)
4. Add a `GET /api/integrations/status` endpoint so frontends can discover
   which services are configured (permanent)
5. Add a single-file example page that demonstrates all integrations and
   gracefully degrades when API keys are missing (disposable)
6. Write developer documentation with upstream links for credential setup
7. Update secret env examples with all required entries

## Success Criteria

- `npm run dev` starts cleanly with zero API keys configured
- The example page shows the counter and three "not configured" cards
- After configuring GitHub credentials, the GitHub card activates and
  OAuth login works, displaying user profile and repos
- After configuring Google credentials, the Google card activates and
  OAuth login works, displaying user profile
- After configuring Pike 13 credentials, the Pike 13 card activates and
  shows this week's events
- Deleting the example page file + its route entry leaves a clean build
  with all backend routes still functional
- `docs/api-integrations.md` links to upstream provider docs for
  credential setup

## Scope

### In Scope

- Express session middleware and Passport.js configuration
- GitHub OAuth strategy and `/api/auth/github/*` routes
- Google OAuth strategy and `/api/auth/google/*` routes
- `/api/auth/me` and `/api/auth/logout` shared auth endpoints
- `/api/github/repos` proxy endpoint
- `/api/pike13/events` and `/api/pike13/people` proxy endpoints
- `/api/integrations/status` configuration status endpoint
- Single-file example React page (`ExampleIntegrations.tsx`)
- `docs/api-integrations.md` documentation
- Updated `secrets/dev.env.example` and `secrets/prod.env.example`
- Updated `docs/secrets.md` required secrets table

### Out of Scope

- Database-backed user persistence (sessions are in-memory for now)
- Google Workspace service account / admin API access
- Pike 13 write operations (only read endpoints)
- React Router (the example page is a single route at `/`)
- Tests (template infrastructure — tested by the example page itself)

## Test Strategy

Manual verification against the success criteria. The example page itself
serves as the integration test — it exercises all backend routes and
displays results visually. Automated tests for auth and API proxy routes
can be added in a future sprint once the patterns are established.

## Architecture Notes

- **Sessions:** Express session with in-memory store (sufficient for dev
  and single-process prod; swap to `connect-pg-simple` later if needed)
- **Passport strategies:** Registered conditionally — strategy is only
  added if the corresponding env vars are set. Routes are always
  registered but return 501 if the strategy is missing.
- **Pike 13 auth:** Authorization code flow per their docs. Access tokens
  don't expire. For the template, we'll use a pre-obtained access token
  stored as `PIKE13_ACCESS_TOKEN` rather than implementing the full OAuth
  redirect flow (Pike 13 is server-to-server, not user-facing login).
- **Graceful degradation:** `/api/integrations/status` checks env vars
  and reports `{ configured: true/false }` per service. Frontend reads
  this on mount and shows/hides features accordingly.
- **Disposable example:** One `.tsx` file with inline `fetch()` calls.
  No shared state, no context providers, no service abstractions.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, technical plan)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On |
|---|-------|------------|
| 001 | Add OAuth secret entries to environment examples | — |
| 002 | Add session and Passport middleware to Express server | 001 |
| 010 | Set up server test infrastructure (Jest + Supertest) | 002 |
| 003 | Add integration status endpoint | 010 |
| 004 | Implement GitHub OAuth auth routes | 010 |
| 005 | Implement Google OAuth auth routes | 004 |
| 006 | Add GitHub repos API proxy endpoint | 004 |
| 007 | Add Pike 13 API proxy routes | 010 |
| 008 | Build single-file example integration page | 003, 004, 005, 006, 007 |
| 009 | Write API integrations documentation | 004, 005, 007 |
