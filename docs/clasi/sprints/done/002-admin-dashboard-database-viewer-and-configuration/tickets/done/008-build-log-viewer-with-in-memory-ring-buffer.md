---
id: 008
title: Build log viewer with in-memory ring buffer
status: in-progress
use-cases:
- SUC-009
depends-on:
- '003'
---

# Build log viewer with in-memory ring buffer

## Description

Add an in-memory log ring buffer that captures pino log entries, an admin
endpoint to read them, and a frontend log viewer page.

## Tasks

1. Create `server/src/services/logBuffer.ts`:
   - Ring buffer class that holds the last ~500 parsed log entries
   - Each entry: `{ timestamp, level, msg, req?, res?, err? }`
   - `push(entry)` — adds to buffer, evicts oldest if full
   - `getEntries(minLevel?)` — returns entries, newest first, optionally
     filtered by minimum log level
   - Export a singleton instance

2. Integrate with pino in `app.ts`:
   - Use `pino.multistream` or `pino.destination` to write to both stdout
     and the ring buffer
   - Parse each log line as JSON before pushing to the buffer
   - Alternatively, use a pino `on('data')` stream handler

3. Create `server/src/routes/admin/logs.ts`:
   - `GET /api/admin/logs` — returns `{ entries: LogEntry[] }` from the
     buffer, newest first
   - Optional `?level=error` query param to filter by minimum level
     (10=trace, 20=debug, 30=info, 40=warn, 50=error, 60=fatal)

4. Mount in admin router.

5. Replace placeholder `client/src/pages/admin/LogViewer.tsx`:
   - Table/list view with timestamp, level (color-coded badge), and message
   - Level filter dropdown (all, info, warn, error)
   - Refresh button to fetch latest entries
   - Auto-scroll to newest entries on load

## Acceptance Criteria

- [ ] Log buffer captures pino output in memory (up to ~500 entries)
- [ ] GET `/api/admin/logs` returns log entries newest-first
- [ ] `?level=error` filters to error and fatal entries only
- [ ] Each entry includes timestamp, level, and message
- [ ] Frontend displays entries with color-coded level badges
- [ ] Level filter dropdown works
- [ ] Refresh button fetches latest entries
- [ ] Endpoint requires admin session
- [ ] Log buffer does not affect stdout output or performance noticeably

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `tests/server/log-buffer.test.ts`: ring buffer eviction, level
    filtering, entry ordering
- **Verification command**: `npm run test:server`
