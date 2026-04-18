---
id: '015'
title: SQLite + PostgreSQL Dual Database Support
status: done
branch: sprint/015-sqlite-postgresql-dual-database-support
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
---

# Sprint 015: SQLite + PostgreSQL Dual Database Support

## Goals

Make the template work with both SQLite (zero-setup for students) and
PostgreSQL (production). Students start with `npm install && npm run dev`
— no Docker, no Postgres. When ready, they graduate to Postgres.

## Problem

The template currently requires Docker + Postgres just to start development.
This is a high barrier for students. Multiple components are hardwired to
Postgres: the session store, raw SQL queries, the admin DB viewer, the
backup service, and the Prisma client initialization.

## Solution

1. Change Prisma schema to `provider = ["sqlite", "postgresql"]`
2. Branch Prisma client initialization: SQLite (no adapter) vs Postgres (PrismaPg)
3. Replace `connect-pg-simple` with a Prisma-based session store
4. Rewrite raw SQL in SessionService to use Prisma ORM
5. Branch scheduler's `FOR UPDATE SKIP LOCKED` (Postgres) vs ORM (SQLite)
6. Abstract admin DB viewer behind a DbIntrospector interface
7. Branch backup service: file copy (SQLite) vs pg_dump (Postgres)
8. Update dev scripts to detect DATABASE_URL and skip Docker for SQLite

## Success Criteria

- `npm install && npm run dev` works with zero Docker/Postgres (SQLite default)
- All existing Postgres functionality continues to work
- Session persistence works on both databases
- Admin panels (DB viewer, scheduler, sessions) work on both
- Backup/restore works on both
- All existing tests pass on Postgres
- New tests verify SQLite-specific paths

## Scope

### In Scope

- Prisma schema dual-provider support
- Prisma client branching (SQLite vs Postgres)
- PrismaSessionStore replacing connect-pg-simple
- SessionService raw SQL → ORM rewrite
- SchedulerService tick() branching
- DbIntrospector for admin DB viewer
- BackupService SQLite support
- Dev script updates (SQLite mode skips Docker)
- wait-for-db.sh SQLite bypass
- .gitignore for data/ directory

### Out of Scope

- SQLite for production deployment
- Data migration tool (SQLite → Postgres) — future sprint
- Test infrastructure rewrite to support SQLite — future sprint
- Documentation updates — future sprint

## Test Strategy

- Run existing server tests against Postgres (must all pass)
- Add targeted tests for PrismaSessionStore
- Add tests for DbIntrospector (both implementations)
- Verify SQLite mode starts and basic CRUD works

## Architecture Notes

- Prisma 7 supports `provider = ["sqlite", "postgresql"]` natively
- Enums work on both (native enum in Postgres, String in SQLite)
- SQLite uses `prisma db push` (no migration history), Postgres keeps `prisma migrate dev`
- `connect-pg-simple` removal eliminates the hardest Postgres dependency
- `isSqlite()` helper centralizes the detection logic

## Definition of Ready

- [x] Sprint planning documents are complete
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

1. #001 — Dual-provider Prisma schema and branching client initialization
2. #002 — Replace connect-pg-simple with PrismaSessionStore
3. #003 — Rewrite SessionService raw SQL to Prisma ORM
4. #004 — Branch SchedulerService tick for SQLite compatibility
5. #005 — Create DbIntrospector and update admin DB viewer
6. #006 — Add SQLite support to BackupService
7. #007 — Update dev scripts and wait-for-db for SQLite mode
