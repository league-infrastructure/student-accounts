---
id: "017"
title: "LEAGUEhub Domain Migration"
status: planning
branch: sprint/017-leaguehub-domain-migration
use-cases: []
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 017: LEAGUEhub Domain Migration

## Goals

Replace the template chat application with LEAGUEhub's student progress reporting domain. After this sprint, `npm run dev` boots a working LEAGUEhub application with instructor dashboards, monthly reviews, templates, TA check-ins, admin compliance, volunteer hours, and Pike13 integration.

## Problem

The LEAGUEhub-orig application uses Drizzle ORM (PostgreSQL-only), custom OAuth, and Wouter routing. The student-progress-report template provides better infrastructure (Prisma dual-DB, Passport.js, ServiceRegistry, React Router, admin dashboard, Docker/dotconfig/rundbat deployment) but currently runs a chat demo. We need to port LEAGUEhub's domain into the template's architecture.

## Solution

Copy files from LEAGUEhub-orig and adapt them to the template's patterns:
- Rewrite the Drizzle schema as Prisma models (different ORM syntax)
- Extract inline route logic into ServiceRegistry service classes
- Copy route handlers, adapting Drizzle queries → Prisma and `req.session.user` → `req.user`
- Copy client pages/components, adapting Wouter → React Router and adding TanStack Query
- Copy email.ts and pike13Sync.ts, converting Drizzle → Prisma

Source: `/Users/eric/proj/scratch/LEAGUEhub-orig/`

## Success Criteria

- `npm run dev` starts server (:3000) and client (:5173) without errors
- Pike13 OAuth login flow works (with graceful fallback when credentials absent)
- Instructor dashboard, review CRUD, template CRUD, check-in all functional
- Admin panels (instructor list, compliance, volunteer hours, feedback) all load
- Public feedback form works via token URL
- SendGrid email no-ops without API key; Pike13 sync no-ops without credentials
- Docker build (`docker compose build`) succeeds
- Existing template admin panels (users, db, logs, sessions, config, etc.) still work

## Scope

### In Scope

- Prisma schema with all LEAGUEhub domain models
- Remove chat infrastructure (channels, messages, SSE)
- All server services, routes, and middleware
- All client pages, components, types
- Pike13 OAuth adaptation to Passport.js
- Client dependencies: Tailwind CSS, TanStack Query, React Hook Form, Zod, Lucide
- Auth middleware (requireInstructor)

### Out of Scope

- New features not in LEAGUEhub-orig
- E2E tests (Playwright)
- Production data migration (no existing production data)
- Changing deployment infrastructure (Docker, dotconfig, rundbat)

## Test Strategy

- Server starts and `/api/health` returns 200
- Manual verification of login flow, dashboard, review CRUD
- Existing template admin panels still function
- Docker build succeeds
- Run `npm run test:server` and `npm run test:client` — update broken tests for schema changes

## Architecture Notes

- **ORM**: Drizzle → Prisma. All queries converted. SQLite-compatible (no PostgreSQL-only features).
- **Auth**: Pike13 OAuth adapted to Passport.js `findOrCreateOAuthUser`. Instructor record loaded in `deserializeUser`.
- **Services**: LEAGUEhub inline route logic extracted into ServiceRegistry classes.
- **Client**: Wouter → React Router. TanStack Query added for data fetching. Tailwind CSS for styling.
- **`@default(uuid())`**: Prisma generates UUIDs app-side — safe for SQLite.
- **Json columns**: Stored as TEXT in SQLite, Prisma handles serialization.
- **PostgreSQL regex `~*`**: Replaced with Prisma `startsWith`/`contains` or app-level filtering.

## GitHub Issues

None.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 01 | Prisma Schema + DB Foundation | — | 1 |
| 02 | Remove Chat Infrastructure | — | 1 |
| 03 | Domain Services | 01 | 2 |
| 04 | Auth + Middleware | 01, 03 | 3 |
| 05 | Domain Route Handlers | 03, 04 | 4 |
| 06 | Client Dependencies + Tailwind | 02 | 2 |
| 07 | Client Instructor Pages | 05, 06 | 5 |
| 08 | Client Admin Pages | 07 | 6 |
| 09 | Cleanup + Verification | 08 | 7 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
