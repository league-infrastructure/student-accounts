---
id: '004'
title: Run full test suite and production smoke tests
status: done
use-cases:
- SUC-002
- SUC-004
depends-on:
- '001'
- '002'
- '003'
---

# Run full test suite and production smoke tests

## Description

Run the complete test suite across all layers, fix any breakage, then perform
production smoke tests to verify the deployment path works end to end.

This is the final verification ticket. All Docker and cleanup work from
tickets 001-003 must be complete before this ticket begins.

### Changes

1. **Create database-level tests** (`tests/db/`):
   - Migration applies cleanly on an empty database
   - All tables created (User, Channel, Message, ScheduledJob,
     RoleAssignmentPattern, Config, Session)
   - Foreign keys and indexes are in place
   - Constraints enforced: unique channel names, unique user emails,
     Message requires valid channelId and authorId
   - Cascade deletes: deleting a channel deletes its messages

2. **Run all automated tests**:
   - `npm run test:server` — all backend API, auth, chat, MCP, admin, and
     service layer tests
   - `npm run test:client` — all frontend component and integration tests
   - `npm run test:db` — database layer tests
   - Fix any failures. Document what broke and why in the ticket notes.

3. **Production image smoke tests**:
   - Build the production image: `npm run build:docker`
   - Start the image with a test database and required env vars
   - Verify `GET /api/health` returns 200
   - Verify `GET /` returns the Vite-built `index.html`
   - Verify SPA fallback: `GET /chat` returns `index.html` (not 404)
   - Verify static assets (JS, CSS) are served with correct content types
   - Verify image size is under 500 MB

4. **Swarm deployment verification** (if a Swarm node is available):
   - `docker stack deploy -c docker-compose.yml collegenav`
   - Verify all services start and reach running/replicated state
   - Verify secrets are loaded (check server logs for successful DB
     connection)
   - Verify Caddy routing if Caddy is available on the node
   - If no Swarm node is available, document what was verified and what
     remains for first production deploy

5. **End-to-end dev workflow verification**:
   - Fresh `npm install` in server/ and client/
   - `npm run dev` starts the full dev stack (DB + server + client)
   - Navigate to `http://localhost:5173`, verify the app loads
   - Log in, access chat, verify core functionality
   - `Ctrl+C` cleanly shuts down all processes

## Acceptance Criteria

- [ ] Database tests created in `tests/db/`: migration, constraints,
      cascade deletes, foreign keys
- [ ] `npm run test:db` exits with code 0
- [ ] `npm run test:server` exits with code 0
- [ ] `npm run test:client` exits with code 0
- [ ] No tests are skipped without a documented reason
- [ ] `npm run build:docker` completes without errors
- [ ] Production image starts and serves both API and client
- [ ] `GET /api/health` returns 200 on the production image
- [ ] `GET /` returns the Vite-built index.html on the production image
- [ ] SPA fallback works on the production image (`GET /chat` returns index.html)
- [ ] Image size is under 500 MB
- [ ] `npm run dev` starts a working dev environment from a clean state
- [ ] Any test failures encountered are fixed and documented

## Testing

- **Existing tests to run**: All of them — this ticket IS the full test run
- **New tests to write**: None (fix existing failures only)
- **Verification commands**:
  - `npm run test:server`
  - `npm run test:client`
  - `npm run build:docker`
  - `docker run --rm -e DATABASE_URL=... -p 3000:3000 collegenav-server:latest`
  - `curl http://localhost:3000/api/health`
  - `curl http://localhost:3000/`
