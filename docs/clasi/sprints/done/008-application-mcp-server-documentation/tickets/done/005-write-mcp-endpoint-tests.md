---
id: '005'
title: Write MCP endpoint tests
status: done
use-cases:
- SUC-001
- SUC-002
depends-on:
- '002'
---

# Write MCP endpoint tests

## Description

Write integration tests for the MCP endpoint that verify authentication,
tool execution, and database side effects. Tests use Supertest against the
Express app and follow the project's existing test patterns (see
`docs/testing.md`).

### Test Cases

1. **Auth: 401 without token** — `POST /api/mcp` with no `Authorization`
   header returns 401.

2. **Auth: 401 with bad token** — `POST /api/mcp` with
   `Authorization: Bearer wrong-token` returns 401.

3. **Tool call: `list_channels` returns data** — `POST /api/mcp` with a
   valid bearer token and a properly formatted MCP `list_channels` tool call
   returns a 200 response containing channel data from the database.

4. **Tool call: `post_message` creates message in DB** — `POST /api/mcp`
   with a valid bearer token and a `post_message` tool call (providing
   `channelId` and `content`) creates a new message in the database. Assert
   both the MCP response and the database state via Prisma query.

5. **Bot user attribution** — Verify that messages created via the MCP
   `post_message` tool have their `authorId` set to the MCP bot user
   (the user with `provider: 'mcp'`). Query the database after the tool
   call to confirm attribution.

### Test Setup

- Set `MCP_DEFAULT_TOKEN` in the test environment
- Seed the database with at least one channel and one user before tests
- Use `request.agent(app)` or direct Supertest calls (no session needed
  for token auth)
- Clean up test data between test files

## Acceptance Criteria

- [ ] Test file exists at `tests/server/mcp.test.ts` (or similar)
- [ ] Test: 401 returned when no token is provided
- [ ] Test: 401 returned when an invalid token is provided
- [ ] Test: valid token + `list_channels` returns channel data
- [ ] Test: valid token + `post_message` creates a message in the database
- [ ] Test: messages created via MCP are attributed to the MCP bot user
- [ ] All tests pass with `npm run test:server`
- [ ] No regressions in existing test suites

## Testing

- **Existing tests to run**: `npm run test:server` (full server test suite)
- **New tests to write**: All test cases described above
- **Verification command**: `npm run test:server`
