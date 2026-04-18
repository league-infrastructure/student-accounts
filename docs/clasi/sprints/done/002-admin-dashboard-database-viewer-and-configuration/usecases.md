---
status: draft
---

# Sprint 002 Use Cases

## SUC-001: Admin Login

- **Actor**: Administrator (developer or operator)
- **Preconditions**: ADMIN_PASSWORD is set in environment/secrets
- **Main Flow**:
  1. User navigates to `/admin`
  2. System displays a password prompt
  3. User enters the admin password and submits
  4. System validates the password against ADMIN_PASSWORD
  5. System sets `isAdmin: true` in the session
  6. System redirects to the admin dashboard
- **Alternative Flow**:
  - 4a. Password is incorrect — system shows an error message, stays on login
- **Postconditions**: Session contains admin flag; subsequent admin requests are authorized
- **Acceptance Criteria**:
  - [ ] POST `/api/admin/login` accepts `{ password }` and returns 200 on success
  - [ ] Incorrect password returns 401
  - [ ] Admin flag persists across page reloads (session in PostgreSQL)
  - [ ] Navigating to any `/admin/*` route without a session redirects to login

## SUC-002: Admin Logout

- **Actor**: Administrator
- **Preconditions**: User has an active admin session
- **Main Flow**:
  1. User clicks "Logout" in the admin UI
  2. System clears the admin flag from the session
  3. System redirects to the admin login page
- **Postconditions**: Admin flag is removed; subsequent admin requests are denied
- **Acceptance Criteria**:
  - [ ] POST `/api/admin/logout` clears admin status and returns 200
  - [ ] After logout, admin pages redirect to login

## SUC-003: View Environment Info

- **Actor**: Administrator
- **Preconditions**: User is authenticated as admin
- **Main Flow**:
  1. User navigates to the Environment section (default admin landing page)
  2. System gathers runtime information
  3. System displays: Node.js version, server uptime, memory usage (RSS,
     heap used/total), deployment mode (NODE_ENV), database connection
     status, configured integrations summary
- **Postconditions**: User sees current server state at a glance
- **Acceptance Criteria**:
  - [ ] GET `/api/admin/env` returns Node version, uptime, memory, deployment mode
  - [ ] Database connectivity is checked (simple query) and reported
  - [ ] Endpoint requires admin session

## SUC-004: View Database Tables

- **Actor**: Administrator
- **Preconditions**: User is authenticated as admin
- **Main Flow**:
  1. User navigates to the Database section of the admin dashboard
  2. System queries `information_schema.tables` for user tables in the
     `public` schema
  3. System displays a list of table names with row counts
- **Postconditions**: User sees all application tables
- **Acceptance Criteria**:
  - [ ] GET `/api/admin/db/tables` returns table names and row counts
  - [ ] Internal tables (_prisma_migrations) are excluded or clearly marked
  - [ ] Endpoint requires admin session (returns 401 without it)

## SUC-005: View Table Records

- **Actor**: Administrator
- **Preconditions**: User is authenticated as admin; a table exists
- **Main Flow**:
  1. User clicks on a table name in the table list
  2. System queries the table for rows (with pagination)
  3. System displays rows in a tabular format with column headers
  4. User can page through results
- **Alternative Flow**:
  - 2a. Table is empty — system shows "No records" message
  - 2b. Table has JSONB columns — system displays them as formatted JSON
- **Postconditions**: User sees the contents of the selected table
- **Acceptance Criteria**:
  - [ ] GET `/api/admin/db/tables/:name` returns paginated rows
  - [ ] Response includes column names, types, and row data
  - [ ] Pagination via `?page=N&limit=N` query params (default 50 rows)
  - [ ] JSONB values are returned as objects (not escaped strings)
  - [ ] Invalid table names return 404
  - [ ] Endpoint requires admin session

## SUC-006: View Current Configuration

- **Actor**: Administrator
- **Preconditions**: User is authenticated as admin
- **Main Flow**:
  1. User navigates to the Configuration section
  2. System loads config values from the Config table, merged with env vars
  3. System displays the current value for each credential (secrets are
     masked, showing only last 4 characters)
  4. Each credential shows its source: "environment", "database", or "not set"
- **Postconditions**: User sees the state of all configurable credentials
- **Acceptance Criteria**:
  - [ ] GET `/api/admin/config` returns all config keys with masked values and source
  - [ ] Secret values are masked (e.g., `••••••••abcd`)
  - [ ] Source indicates whether the value comes from env var or database
  - [ ] Endpoint requires admin session

## SUC-007: Update Configuration

- **Actor**: Administrator
- **Preconditions**: User is authenticated as admin
- **Main Flow**:
  1. User enters a new value for a credential in the config form
  2. User clicks Save
  3. System writes the value to the Config table (plaintext)
  4. System reloads the in-memory config cache
  5. System confirms the update
- **Alternative Flow**:
  - 3a. An env var exists for this key — system warns that the env var takes
    precedence but still saves to the database
  - 5a. Key is an OAuth credential (client ID/secret) — system shows a
    "restart required" notice since Passport strategies are registered at
    startup
- **Postconditions**: New value is persisted; non-OAuth keys take effect
  immediately; OAuth keys require a server restart
- **Acceptance Criteria**:
  - [ ] PUT `/api/admin/config` accepts `{ key, value }` and returns 200
  - [ ] Value is stored in plaintext in the Config table
  - [ ] Server-side config cache is refreshed after update
  - [ ] If an env var overrides the key, response includes a warning
  - [ ] OAuth keys include a "restart required" notice in the response
  - [ ] Endpoint requires admin session

## SUC-008: Export Configuration

- **Actor**: Administrator
- **Preconditions**: User is authenticated as admin; at least one config value is set
- **Main Flow**:
  1. User clicks "Export" button on the Configuration page
  2. System generates a `.env`-formatted text snippet containing all config
     values from the database (unmasked)
  3. Browser downloads the snippet as a file (e.g., `config-export.env`)
- **Postconditions**: User has a file they can paste into their secrets files
- **Acceptance Criteria**:
  - [ ] GET `/api/admin/config/export` returns plaintext `KEY=value` format
  - [ ] Response Content-Disposition triggers a file download
  - [ ] Only database-stored values are included (not env var values)
  - [ ] Endpoint requires admin session

## SUC-009: View Server Logs

- **Actor**: Administrator
- **Preconditions**: User is authenticated as admin
- **Main Flow**:
  1. User navigates to the Logs section
  2. System returns the most recent log entries from the in-memory ring buffer
  3. System displays log entries with timestamp, level, and message
  4. User can filter by log level (info, warn, error)
- **Postconditions**: User sees recent server activity
- **Acceptance Criteria**:
  - [ ] GET `/api/admin/logs` returns recent log entries (up to 500)
  - [ ] Each entry includes timestamp, level, msg, and optional request metadata
  - [ ] Optional `?level=error` query param filters by minimum level
  - [ ] Logs are displayed newest-first
  - [ ] Endpoint requires admin session

## SUC-010: View Active Sessions

- **Actor**: Administrator
- **Preconditions**: User is authenticated as admin
- **Main Flow**:
  1. User navigates to the Sessions section
  2. System queries the session table for all active sessions
  3. System displays session ID (truncated), expiry time, and whether the
     session has an admin flag or OAuth user attached
- **Postconditions**: User sees who is using the application
- **Acceptance Criteria**:
  - [ ] GET `/api/admin/sessions` returns active sessions with metadata
  - [ ] Session IDs are truncated for display (first 8 chars)
  - [ ] Expired sessions are excluded
  - [ ] Shows whether session has admin access or OAuth user data
  - [ ] Endpoint requires admin session

## SUC-011: Configurable Credentials

The following credentials are manageable via the admin config panel:

| Key | Description | Group | Restart Required |
|-----|-------------|-------|-----------------|
| GITHUB_CLIENT_ID | GitHub OAuth app client ID | GitHub OAuth | Yes |
| GITHUB_CLIENT_SECRET | GitHub OAuth app client secret | GitHub OAuth | Yes |
| GOOGLE_CLIENT_ID | Google OAuth app client ID | Google OAuth | Yes |
| GOOGLE_CLIENT_SECRET | Google OAuth app client secret | Google OAuth | Yes |
| PIKE13_CLIENT_ID | Pike 13 OAuth app client ID | Pike 13 | Yes |
| PIKE13_CLIENT_SECRET | Pike 13 OAuth app client secret | Pike 13 | Yes |
| PIKE13_API_BASE | Pike 13 API base URL | Pike 13 | No |
| GITHUB_TOKEN | GitHub personal access token (repo access) | GitHub API | No |
| GITHUB_STORAGE_REPO | GitHub repo used as file storage (owner/repo) | GitHub API | No |
| ANTHROPIC_API_KEY | Claude API key | AI Services | No |
| OPENAI_API_KEY | OpenAI API key | AI Services | No |

- **Acceptance Criteria**:
  - [ ] All keys listed above appear in the config panel, grouped by category
  - [ ] OAuth keys show "restart required" badge
  - [ ] All keys are present in `secrets/dev.env.example` and `secrets/prod.env.example`
