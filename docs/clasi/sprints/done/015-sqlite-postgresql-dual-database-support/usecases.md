---
status: draft
---

# Sprint 015 Use Cases

## SUC-001: SQLite Zero-Setup Development
Parent: Infrastructure

- **Actor**: Student developer
- **Preconditions**: Node.js installed, no Docker or Postgres
- **Main Flow**:
  1. Student clones the template repo
  2. Runs `npm install && npm run dev`
  3. App starts with SQLite database (file:./data/dev.db)
  4. Prisma pushes schema to SQLite file
  5. Server starts, client starts, app is functional
- **Postconditions**: Fully working dev environment with no external dependencies
- **Acceptance Criteria**:
  - [ ] `DATABASE_URL=file:./data/dev.db` works as default
  - [ ] `prisma db push` creates SQLite schema correctly
  - [ ] Server starts and serves API endpoints
  - [ ] Client can login, create channels, send messages

## SUC-002: Database-Agnostic Session Persistence
Parent: Infrastructure

- **Actor**: Any user logging into the app
- **Preconditions**: App running on either SQLite or Postgres
- **Main Flow**:
  1. User logs in via OAuth or test-login
  2. Session is stored via PrismaSessionStore
  3. User refreshes the page
  4. Session is retrieved, user remains logged in
- **Postconditions**: Session persists across requests on both databases
- **Acceptance Criteria**:
  - [ ] PrismaSessionStore implements Express session.Store interface
  - [ ] Sessions persist across server restarts (stored in DB)
  - [ ] Expired sessions can be cleaned up
  - [ ] Works identically on SQLite and Postgres

## SUC-003: Admin Panels on Both Databases
Parent: Admin Dashboard

- **Actor**: Admin user
- **Preconditions**: App running on either SQLite or Postgres
- **Main Flow**:
  1. Admin opens DB viewer — sees tables and rows
  2. Admin opens Sessions panel — sees active sessions
  3. Admin opens Scheduler panel — sees scheduled jobs
  4. Admin triggers backup — backup is created
- **Postconditions**: All admin functionality works regardless of database
- **Acceptance Criteria**:
  - [ ] DB viewer shows tables on both SQLite and Postgres
  - [ ] Session list works (ORM queries replace raw SQL)
  - [ ] Scheduler tick works (ORM on SQLite, FOR UPDATE SKIP LOCKED on Postgres)
  - [ ] Backup creates .db copy on SQLite, pg_dump on Postgres

## SUC-004: Postgres Mode Backward Compatibility
Parent: Infrastructure

- **Actor**: Developer using Postgres
- **Preconditions**: Docker and Postgres available, DATABASE_URL set to postgres://
- **Main Flow**:
  1. Developer sets DATABASE_URL to postgres connection string
  2. Runs `npm run dev:postgres` (Docker + Postgres flow)
  3. All existing functionality works exactly as before
- **Postconditions**: Zero regressions for existing Postgres users
- **Acceptance Criteria**:
  - [ ] All existing server tests pass on Postgres
  - [ ] PrismaPg adapter still used for Postgres connections
  - [ ] connect-pg-simple removal doesn't break session behavior
  - [ ] Migrations still work via `prisma migrate dev`
