---
status: draft
---

# Sprint 001 Use Cases

## SUC-001: Developer configures OAuth credentials
Parent: N/A (template infrastructure)

- **Actor**: Developer using this template
- **Preconditions**: Template cloned, `./scripts/install.sh` run, `npm run dev` works
- **Main Flow**:
  1. Developer reads `docs/api-integrations.md`
  2. Developer follows the upstream link to create an OAuth app (GitHub,
     Google, or Pike 13)
  3. Developer copies client ID and secret into `secrets/dev.env`
  4. Developer re-runs `./scripts/install.sh` (or manually updates `.env`)
  5. Developer restarts `npm run dev`
  6. The example page now shows the configured service as active
- **Postconditions**: The integration is available in the running app
- **Acceptance Criteria**:
  - [ ] `docs/api-integrations.md` exists with upstream links for all 3 services
  - [ ] `secrets/dev.env.example` lists all required env var names
  - [ ] After adding credentials and restarting, the service card becomes active

## SUC-002: User logs in via GitHub OAuth
Parent: N/A (template infrastructure)

- **Actor**: End user of an app built from this template
- **Preconditions**: GitHub OAuth credentials are configured
- **Main Flow**:
  1. User clicks "Connect GitHub" on the example page
  2. Browser redirects to GitHub authorization page
  3. User grants permission
  4. GitHub redirects back to `/api/auth/github/callback`
  5. Server stores GitHub profile and access token in session
  6. Server redirects to `/`
  7. Example page calls `/api/auth/me` and displays GitHub profile
  8. Example page calls `/api/github/repos` and displays repo list
- **Postconditions**: User is authenticated, session contains GitHub profile
- **Acceptance Criteria**:
  - [ ] OAuth redirect to GitHub works
  - [ ] Callback stores profile in session
  - [ ] `/api/auth/me` returns GitHub user data
  - [ ] `/api/github/repos` returns user's repositories
  - [ ] Example page displays profile and repos

## SUC-003: User logs in via Google OAuth
Parent: N/A (template infrastructure)

- **Actor**: End user of an app built from this template
- **Preconditions**: Google OAuth credentials are configured
- **Main Flow**:
  1. User clicks "Connect Google" on the example page
  2. Browser redirects to Google authorization page
  3. User grants permission
  4. Google redirects back to `/api/auth/google/callback`
  5. Server stores Google profile in session
  6. Server redirects to `/`
  7. Example page calls `/api/auth/me` and displays Google profile
- **Postconditions**: User is authenticated, session contains Google profile
- **Acceptance Criteria**:
  - [ ] OAuth redirect to Google works
  - [ ] Callback stores profile in session
  - [ ] `/api/auth/me` returns Google user data
  - [ ] Example page displays profile (name, email, avatar)

## SUC-004: User views Pike 13 events
Parent: N/A (template infrastructure)

- **Actor**: End user of an app built from this template
- **Preconditions**: Pike 13 credentials are configured on the server
- **Main Flow**:
  1. User clicks "Show This Week's Events" on the example page
  2. Frontend calls `GET /api/pike13/events`
  3. Server calls Pike 13 Core API v2 event_occurrences endpoint
  4. Server returns formatted event list
  5. Example page displays events in a table
- **Postconditions**: Events are displayed
- **Acceptance Criteria**:
  - [ ] `/api/pike13/events` returns event data from Pike 13
  - [ ] Example page renders events (name, date/time, instructor)
  - [ ] If Pike 13 is not configured, endpoint returns 501 with clear message

## SUC-005: App starts with no integrations configured
Parent: N/A (template infrastructure)

- **Actor**: Developer who just cloned the template
- **Preconditions**: Fresh clone, `./scripts/install.sh` run, no API keys in env
- **Main Flow**:
  1. Developer runs `npm run dev`
  2. Server starts without errors
  3. Developer opens browser to `http://localhost:5173`
  4. Example page loads, counter works
  5. Three integration cards show "not configured" with links to setup docs
- **Postconditions**: App is fully functional minus the unconfigured integrations
- **Acceptance Criteria**:
  - [ ] Server starts with zero API keys and no errors
  - [ ] No warnings in server log beyond one-time info per unconfigured service
  - [ ] Example page shows counter + three "not configured" cards
  - [ ] Each card links to `docs/api-integrations.md` for setup instructions
