---
status: draft
---

# Sprint 002 Technical Plan

## Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│  Frontend (React + React Router)                         │
│                                                          │
│  /              → ExampleIntegrations (demo, deletable)  │
│  /admin         → AdminLogin                             │
│  /admin/env     → EnvironmentInfo                        │
│  /admin/db      → DatabaseViewer (table list + detail)   │
│  /admin/config  → ConfigPanel (credential management)    │
│  /admin/logs    → LogViewer                              │
│  /admin/sessions → SessionViewer                         │
└─────────────────────────┬────────────────────────────────┘
                          │ /api
┌─────────────────────────┴────────────────────────────────┐
│  Backend (Express)                                       │
│                                                          │
│  POST /api/admin/login           → validate password     │
│  POST /api/admin/logout          → clear admin session   │
│  GET  /api/admin/env             → runtime info          │
│  GET  /api/admin/db/tables       → list tables + counts  │
│  GET  /api/admin/db/tables/:name → paginated rows        │
│  GET  /api/admin/config          → read all config       │
│  PUT  /api/admin/config          → update a config key   │
│  GET  /api/admin/config/export   → download .env snippet │
│  GET  /api/admin/logs            → recent log entries    │
│  GET  /api/admin/sessions        → active sessions       │
│                                                          │
│  requireAdmin middleware guards all /api/admin/* except   │
│  login                                                   │
└─────────────────────────┬────────────────────────────────┘
                          │
┌─────────────────────────┴────────────────────────────────┐
│  PostgreSQL                                              │
│                                                          │
│  Config table (key-value store for credentials)          │
│  session table (existing — queried for session viewer)   │
│  information_schema (read-only introspection)            │
└──────────────────────────────────────────────────────────┘
```

## Component Design

### Component: Admin Authentication

**Use Cases**: SUC-001, SUC-002

**Backend** (`server/src/routes/admin/auth.ts`):

- `POST /api/admin/login` — accepts `{ password }`, compares against
  `process.env.ADMIN_PASSWORD` using `crypto.timingSafeEqual`. On success,
  sets `req.session.isAdmin = true`.
- `POST /api/admin/logout` — clears `req.session.isAdmin`.

**Middleware** (`server/src/middleware/requireAdmin.ts`):

- Checks `req.session.isAdmin === true`.
- Returns 401 `{ error: "Admin authentication required" }` if not set.
- Applied to all `/api/admin/*` routes except `/api/admin/login`.

**Frontend** (`client/src/pages/admin/AdminLogin.tsx`):

- Simple password form. On submit, POST to `/api/admin/login`.
- On success, redirect to `/admin/env` (environment info as landing page).
- On failure, show error message.

**Session typing**: Extend `express-session` `SessionData` to include
`isAdmin?: boolean`.

### Component: Environment Info

**Use Cases**: SUC-003

**Backend** (`server/src/routes/admin/env.ts`):

- `GET /api/admin/env` — returns:
  ```json
  {
    "node": "v20.x.x",
    "uptime": 12345,
    "memory": { "rss": 52428800, "heapUsed": 28311552, "heapTotal": 40894464 },
    "deployment": "dev",
    "database": "connected",
    "integrations": {
      "github": { "configured": true },
      "google": { "configured": false },
      "pike13": { "configured": true }
    }
  }
  ```
- Database status checked via `prisma.$queryRaw\`SELECT 1\`` wrapped in
  try/catch.
- Integration status reuses the same logic as the existing
  `/api/integrations/status` endpoint.

**Frontend** (`client/src/pages/admin/EnvironmentInfo.tsx`):

- Card-based layout showing each category.
- Uptime displayed as human-readable (e.g., "2h 15m 30s").
- Memory displayed in MB.
- Integration status shown as green/red indicators.

### Component: Database Viewer

**Use Cases**: SUC-004, SUC-005

**Backend** (`server/src/routes/admin/db.ts`):

- `GET /api/admin/db/tables` — queries:
  ```sql
  SELECT table_name
  FROM information_schema.tables
  WHERE table_schema = 'public'
    AND table_type = 'BASE TABLE'
  ORDER BY table_name
  ```
  Then for each table, gets the row count via
  `SELECT count(*) FROM "<table_name>"`.
  Returns `[{ name: string, rowCount: number }]`.

- `GET /api/admin/db/tables/:name` — validates table name exists in the
  table list (prevents SQL injection), then queries:
  ```sql
  SELECT * FROM "<table_name>"
  ORDER BY 1
  LIMIT $limit OFFSET $offset
  ```
  Also returns column metadata from `information_schema.columns`:
  ```sql
  SELECT column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public' AND table_name = $1
  ORDER BY ordinal_position
  ```
  Returns `{ columns, rows, total, page, limit }`.

**Frontend** (`client/src/pages/admin/DatabaseViewer.tsx`):

- Left panel or top section: list of tables with row counts.
- Main area: table rows rendered in an HTML table.
- Pagination controls (prev/next, page size selector).
- JSONB columns rendered as formatted, collapsible JSON.

**Security**: Table names are validated against `information_schema` before
use in queries — never interpolated directly into SQL strings.

### Component: Configuration Panel

**Use Cases**: SUC-006, SUC-007, SUC-008, SUC-011

**Prisma Model** (`server/prisma/schema.prisma`):

```prisma
model Config {
  key       String   @id
  value     String
  updatedAt DateTime @updatedAt
}
```

Values stored in plaintext.

**Service** (`server/src/services/config.ts`):

- `getConfig(key)` — returns env var if set, otherwise queries Config table,
  otherwise returns undefined.
- `getAllConfig()` — returns all known keys with values (masked for display),
  sources ("environment" | "database" | "not set"), and metadata (group,
  label, isSecret, requiresRestart).
- `setConfig(key, value)` — upserts into Config table, refreshes in-memory
  cache.
- `exportConfig()` — returns all database-stored values as unmasked
  `KEY=value` lines.
- In-memory cache: `Map<string, string>` loaded at startup from Config
  table, refreshed on writes.
- Known keys defined in a constant:
  ```typescript
  const CONFIG_KEYS = [
    { key: 'GITHUB_CLIENT_ID', group: 'GitHub OAuth', label: 'Client ID', isSecret: false, requiresRestart: true },
    { key: 'GITHUB_CLIENT_SECRET', group: 'GitHub OAuth', label: 'Client Secret', isSecret: true, requiresRestart: true },
    // ... etc
  ];
  ```

**Backend** (`server/src/routes/admin/config.ts`):

- `GET /api/admin/config` — calls `getAllConfig()`, masks secret values
  (show last 4 chars: `••••••••abcd`).
- `PUT /api/admin/config` — accepts `{ key, value }`, validates key is in
  CONFIG_KEYS, calls `setConfig()`. Returns `{ success, warning?, restart? }`.
- `GET /api/admin/config/export` — calls `exportConfig()`, returns as
  `text/plain` with `Content-Disposition: attachment; filename=config-export.env`.

**Frontend** (`client/src/pages/admin/ConfigPanel.tsx`):

- Groups credentials by category (GitHub OAuth, Google OAuth, Pike 13,
  GitHub API, AI Services).
- Each credential shows: label, current masked value, source badge
  (env/database/not set).
- Edit button reveals an input field; Save button submits.
- Warning banner when an env var overrides a database value.
- "Restart required" badge on OAuth credential rows.
- Export button at the top triggers file download.

### Component: Log Viewer

**Use Cases**: SUC-009

**Log Ring Buffer** (`server/src/services/logBuffer.ts`):

- A pino custom transport (or destination wrapper) that captures log entries
  into a fixed-size in-memory array (ring buffer, ~500 entries).
- Each entry stored as a parsed JSON object with timestamp, level, msg, and
  optional req/res metadata.
- Integrated into the pino setup in `app.ts` via `pino.multistream` or
  `pino.transport` — logs go to both stdout and the ring buffer.

**Backend** (`server/src/routes/admin/logs.ts`):

- `GET /api/admin/logs` — returns the buffer contents, newest first.
- Optional `?level=error` query param filters to entries at or above the
  specified level.
- Returns `{ entries: LogEntry[] }`.

**Frontend** (`client/src/pages/admin/LogViewer.tsx`):

- Table or list view with timestamp, level (color-coded), and message.
- Level filter dropdown (all, info, warn, error).
- Auto-scroll to newest entries.
- Refresh button to fetch latest.

### Component: Session Viewer

**Use Cases**: SUC-010

**Backend** (`server/src/routes/admin/sessions.ts`):

- `GET /api/admin/sessions` — queries the `session` table directly:
  ```sql
  SELECT sid, sess, expire
  FROM session
  WHERE expire > NOW()
  ORDER BY expire DESC
  ```
- Parses the `sess` JSONB to extract useful metadata: whether `isAdmin` is
  set, whether an OAuth user is attached, cookie expiry.
- Truncates `sid` to first 8 characters for display.
- Returns `[{ sid, expire, isAdmin, hasUser, provider }]`.

**Frontend** (`client/src/pages/admin/SessionViewer.tsx`):

- Table showing truncated session ID, admin status, user info, expiry.
- Visual indicator for sessions expiring soon.

### Component: React Router Setup

**Use Cases**: All (navigation infrastructure)

Install `react-router-dom`. Update `client/src/App.tsx`:

```tsx
<BrowserRouter>
  <Routes>
    <Route path="/" element={<ExampleIntegrations />} />
    <Route path="/admin" element={<AdminLogin />} />
    <Route path="/admin/*" element={<AdminLayout />}>
      <Route path="env" element={<EnvironmentInfo />} />
      <Route path="db" element={<DatabaseViewer />} />
      <Route path="config" element={<ConfigPanel />} />
      <Route path="logs" element={<LogViewer />} />
      <Route path="sessions" element={<SessionViewer />} />
    </Route>
  </Routes>
</BrowserRouter>
```

**Admin Layout** (`client/src/pages/admin/AdminLayout.tsx`):

- Simple sidebar with navigation links: Environment, Database,
  Configuration, Logs, Sessions.
- Logout button in the sidebar footer.
- Checks admin auth status on mount — redirects to `/admin` (login) if
  not authenticated.
- `<Outlet />` for rendering child routes.

### Component: New Secrets

**Use Cases**: SUC-011

Add to `secrets/dev.env.example` and `secrets/prod.env.example`:

```env
# --- Admin ---
ADMIN_PASSWORD=change-me

# --- GitHub API (personal access token) ---
GITHUB_TOKEN=your-github-token
GITHUB_STORAGE_REPO=owner/repo-name

# --- AI Services ---
ANTHROPIC_API_KEY=your-anthropic-api-key
OPENAI_API_KEY=your-openai-api-key
```

Update `server/src/routes/integrations.ts` to report status for the new
services (GitHub token, Claude, OpenAI).

## File Structure

New and modified files:

```
server/src/
  middleware/
    requireAdmin.ts              (NEW)
  routes/
    admin/
      index.ts                   (NEW — mounts sub-routes)
      auth.ts                    (NEW — login/logout)
      env.ts                     (NEW — environment info)
      db.ts                      (NEW — table list, row viewer)
      config.ts                  (NEW — config CRUD + export)
      logs.ts                    (NEW — log buffer endpoint)
      sessions.ts                (NEW — session list)
  services/
    config.ts                    (NEW — config loader + cache)
    logBuffer.ts                 (NEW — in-memory log ring buffer)
  app.ts                         (MODIFIED — mount admin routes, log buffer)
  prisma/
    schema.prisma                (MODIFIED — add Config model)

client/
  package.json                   (MODIFIED — add react-router-dom)
  src/
    App.tsx                      (MODIFIED — add React Router)
    pages/
      admin/
        AdminLogin.tsx           (NEW)
        AdminLayout.tsx          (NEW — sidebar nav + outlet)
        EnvironmentInfo.tsx      (NEW)
        DatabaseViewer.tsx       (NEW)
        ConfigPanel.tsx          (NEW)
        LogViewer.tsx            (NEW)
        SessionViewer.tsx        (NEW)
    pages/
      ExampleIntegrations.tsx    (MODIFIED — add link to /admin)

secrets/
  dev.env.example                (MODIFIED — new entries)
  prod.env.example               (MODIFIED — new entries)
```

## Design Decisions

1. **Config values stored in plaintext** — The database is already
   access-controlled, and secrets are encrypted at rest via SOPS. Adding
   application-level encryption would add complexity without meaningful
   security benefit in this context.

2. **OAuth credentials require restart** — Passport strategies are registered
   once at startup. Re-registering them at runtime would require managing
   strategy lifecycle and is error-prone. The admin UI shows a clear
   "restart required" notice when these values change. Non-OAuth keys
   (tokens, API keys) take effect immediately via the config cache.

3. **Admin password as plaintext comparison** — Using
   `crypto.timingSafeEqual` for timing-attack resistance. The password is an
   env var set by the operator, protected by SOPS encryption at rest. No
   hashing needed since there's no user registration flow.

4. **Log ring buffer** — In-memory only, no persistence. Keeps the last ~500
   entries. This is sufficient for debugging recent issues without adding
   file I/O or disk management complexity.

5. **Session viewer is read-only** — No ability to invalidate sessions from
   the admin UI in this sprint. Just visibility into what's active.

## Open Questions

None — all design decisions resolved with stakeholder input.
