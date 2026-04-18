---
id: 008
title: Application MCP Server & Documentation
status: done
branch: sprint/008-application-mcp-server-documentation
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
---

# Sprint 008: Application MCP Server & Documentation

## Goals

Build a built-in HTTP-based MCP server at `/api/mcp` with token
authentication, AsyncLocalStorage context, and chat-related tools. Update
all project documentation to reflect template v2 changes introduced across
sprints 004-008.

## Problem

The template has no way for external AI clients (Claude Desktop, Claude
Code, other MCP clients) to interact with the application's data and
services programmatically. Every app built from the template would need
to implement MCP from scratch. Additionally, the project documentation
still describes the pre-v2 template architecture — config layout, service
layer, auth system, admin dashboard, UI shell, and chat app are all
undocumented or documented incorrectly.

## Solution

1. Create `server/src/mcp/` with four modules: `server.ts` (McpServer
   creation and tool registration), `context.ts` (AsyncLocalStorage for
   user and ServiceRegistry), `tools.ts` (tool definitions with Zod
   schemas), and `handler.ts` (Express route handler with per-request
   transport).
2. Use `@modelcontextprotocol/sdk` with `StreamableHTTPServerTransport`
   for the HTTP transport layer.
3. Implement token-based auth middleware validating `MCP_DEFAULT_TOKEN`
   from environment variables.
4. Register example tools that demonstrate the full pattern: read-only
   tools (`get_version`, `list_users`, `list_channels`,
   `get_channel_messages`) and write tools (`post_message`,
   `create_channel`) that operate through the ServiceRegistry.
5. Build an MCP Setup page in the client showing endpoint URL, token
   configuration, and example client config snippets.
6. Update all documentation files to reflect the current state of the
   template.

## Dependencies

Sprint 007 (UI Shell & Chat Example Application) must be complete. The
MCP tools interact with the chat channels and messages created in that
sprint. The ServiceRegistry, auth system, and admin dashboard from
sprints 004-006 are also prerequisites.

## Success Criteria

- `POST /api/mcp` with a valid bearer token and a `list_channels` tool
  call returns the list of channels from the database
- `POST /api/mcp` with a valid bearer token and a `post_message` tool
  call creates a message in the database attributed to the MCP bot user
- `POST /api/mcp` without a token or with an invalid token returns 401
- MCP Setup page loads and displays the endpoint URL and configuration
  instructions
- All MCP endpoint tests pass (`npm run test:server`)
- Documentation files (`template-spec.md`, `secrets.md`, `deployment.md`,
  `setup.md`, `testing.md`, `AGENTS.md`) are updated and internally
  consistent

## Scope

### In Scope

- `server/src/mcp/` directory: `server.ts`, `context.ts`, `tools.ts`,
  `handler.ts`
- `@modelcontextprotocol/sdk` with `StreamableHTTPServerTransport`
- Token-based auth middleware (`MCP_DEFAULT_TOKEN` env var)
- AsyncLocalStorage context: `{ user, services: ServiceRegistry }`
- Example MCP tools: `get_version`, `list_users`, `list_channels`,
  `get_channel_messages`, `post_message`, `create_channel`
- `POST /api/mcp` Express route registration
- MCP Setup page (`client/src/pages/McpSetup.tsx`) showing endpoint URL,
  token config, and example client configuration
- MCP endpoint tests: auth rejection, tool calls, DB writes
- Documentation updates:
  - `docs/template-spec.md` — config directory, service layer, MCP server,
    Docker architecture, admin dashboard features
  - `docs/secrets.md` — `config/` directory migration
  - `docs/deployment.md` — new Docker model
  - `docs/setup.md` — new first-time setup flow
  - `docs/testing.md` — updated test patterns if needed
  - `AGENTS.md` — service layer guidance for agents

### Out of Scope

- Production deployment (Sprint 009)
- WebSocket or SSE transport for MCP (HTTP-only in this sprint)
- MCP resource or prompt primitives (tools only)
- New database models (uses existing User, Channel, Message from prior
  sprints)
- Client-side MCP client (this is a server-side MCP server for external
  clients)

## Test Strategy

- **MCP auth tests**: Verify 401 on missing token, invalid token; verify
  200 on valid bearer token
- **MCP tool call tests**: Call each registered tool via the MCP endpoint
  and verify correct responses (channels listed, messages returned,
  message created in DB, channel created in DB)
- **MCP bot attribution**: Verify that messages posted via MCP are
  attributed to the correct system/bot user
- **Integration**: Verify the full flow — authenticate, call tool, verify
  DB state — using Supertest against the Express app
- Run `npm run test:server` to confirm no regressions

## Architecture Notes

**AsyncLocalStorage pattern**: Each MCP request creates a context with
the authenticated user and a ServiceRegistry instance (with source `'MCP'`).
Tools access this context via `getContext()` without needing explicit
parameter passing. This mirrors the inventory app's pattern.

**Tool registration**: Each tool is defined with a Zod input schema and
an async handler function. The handler calls `getContext()` to get the
ServiceRegistry and performs operations through services, never through
raw Prisma calls.

**Transport**: `StreamableHTTPServerTransport` handles the MCP protocol
over HTTP. The Express handler creates a new transport per request,
wraps execution in the AsyncLocalStorage context, and lets the SDK
handle serialization.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

1. **001** — Create MCP server infrastructure
2. **002** — Implement MCP tools
3. **003** — Build MCP setup page
4. **004** — Update all project documentation
5. **005** — Write MCP endpoint tests
