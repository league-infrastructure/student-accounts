---
status: done
priority: high
sprint: '015'
---

# SQLite + PostgreSQL Dual Database Support

Add SQLite as the default development database so students can start with
zero setup (`npm install && npm run dev`), then graduate to Postgres when
they're ready for production deployment.

## Key Changes

1. **Prisma schema** — change provider to `["sqlite", "postgresql"]`, remove
   Postgres-specific `@db.*` annotations from Session model
2. **Prisma client** — branch initialization: SQLite uses native Prisma (no
   adapter), Postgres uses `@prisma/adapter-pg`
3. **Session store** — replace `connect-pg-simple` with a Prisma-based session
   store that implements the Express `session.Store` interface using ORM calls.
   Works identically on both databases, no extra dependencies
4. **Raw SQL elimination** — rewrite `session.service.ts` to use Prisma ORM
   instead of `$queryRaw`; branch `scheduler.service.ts` `FOR UPDATE SKIP
   LOCKED` (Postgres) vs simple ORM query (SQLite)
5. **Admin DB viewer** — abstract `information_schema` queries behind a
   `DbIntrospector` interface with Postgres and SQLite implementations
6. **Backup service** — SQLite mode copies the `.db` file; Postgres keeps
   existing `pg_dump`/`psql` logic
7. **Dev scripts** — detect `DATABASE_URL` prefix; SQLite skips Docker and
   uses `prisma db push`; Postgres uses existing Docker-based flow
8. **Data migration path** — use existing `exportJson()` to move data from
   SQLite to Postgres when transitioning

## Default Experience

`.env` ships with `DATABASE_URL=file:./data/dev.db`. Students clone, run
`npm install && npm run dev`, and get a working app immediately. No Docker,
no Postgres.

## Reference

- Plan file: `/Users/eric/.claude/plans/starry-squishing-curry.md`
- Inventory app has a working dual-DB example

## Verification

- `npm install && npm run dev` works with zero Docker/Postgres
- Session persistence works on both databases
- Admin panels work on both (DB viewer, scheduler, sessions)
- All existing Postgres tests continue to pass
- Export → switch to Postgres → import works end-to-end
