---
id: '006'
title: Build database viewer (table list and record browser)
status: in-progress
use-cases:
- SUC-004
- SUC-005
depends-on:
- '003'
---

# Build database viewer (table list and record browser)

## Description

Build the database introspection endpoints and the frontend viewer. Admins
can list all tables with row counts, then click into any table to browse
its rows with pagination. Read-only — no editing.

## Tasks

1. Create `server/src/routes/admin/db.ts`:

   - `GET /api/admin/db/tables`:
     - Query `information_schema.tables` for `public` schema, `BASE TABLE`
     - For each table, get row count via `SELECT count(*)`
     - Return `[{ name, rowCount }]` sorted by name

   - `GET /api/admin/db/tables/:name`:
     - Validate `:name` exists in the table list (SQL injection prevention)
     - Query column metadata from `information_schema.columns`
     - Query rows: `SELECT * FROM "<name>" ORDER BY 1 LIMIT $limit OFFSET $offset`
     - Accept `?page=1&limit=50` query params
     - Return `{ columns: [{name, type, nullable}], rows: any[], total, page, limit }`

2. Mount in admin router.

3. Replace placeholder `client/src/pages/admin/DatabaseViewer.tsx`:
   - Table list panel with table names and row counts
   - Clicking a table fetches and displays its rows
   - HTML table with column headers
   - JSONB columns rendered as formatted JSON (collapsible)
   - Pagination controls (prev/next, current page, total)
   - "No records" message for empty tables

## Acceptance Criteria

- [ ] GET `/api/admin/db/tables` returns all public tables with row counts
- [ ] `_prisma_migrations` is included but visually marked as internal
- [ ] GET `/api/admin/db/tables/:name` returns paginated rows with column metadata
- [ ] Invalid table name returns 404
- [ ] JSONB values are returned as objects (not escaped strings)
- [ ] Pagination works correctly (page, limit, total)
- [ ] Frontend displays tables, rows, and handles empty tables
- [ ] Endpoints require admin session

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `tests/server/admin-db.test.ts`: table list returns known tables,
    row fetch with pagination, invalid table 404, auth required
- **Verification command**: `npm run test:server`
