---
id: '001'
title: Create MCP server infrastructure
status: done
use-cases:
- SUC-001
depends-on: []
---

# Create MCP server infrastructure

## Description

Create the foundational MCP server infrastructure in `server/src/mcp/`. This
establishes the HTTP-based MCP endpoint that external AI clients (Claude
Desktop, Claude Code, etc.) use to interact with the application. The
infrastructure includes the McpServer instance, AsyncLocalStorage context for
request-scoped access to user and services, the Express route handler that
bridges HTTP to MCP, and token-based authentication middleware.

### Changes

1. **`server/src/mcp/server.ts`** — Create the McpServer instance using
   `@modelcontextprotocol/sdk`. Export a `createMcpServer()` function that
   instantiates `McpServer` with app metadata (name, version). Tool
   registration happens here after tools are defined in ticket #002.

2. **`server/src/mcp/context.ts`** — Create AsyncLocalStorage-based context
   module. Export `runWithContext(ctx, fn)` to wrap MCP request execution and
   `getContext()` for tool handlers to access `{ user, services }`. The
   `McpContext` interface holds the authenticated `User` and a
   `ServiceRegistry` instance.

3. **`server/src/mcp/handler.ts`** — Create the Express route handler.
   The handler receives authenticated requests, creates a `ServiceRegistry`
   with source `'MCP'`, creates a `StreamableHTTPServerTransport` (with
   `sessionIdGenerator: undefined` for stateless operation), wraps execution
   in `runWithContext()`, and pipes the transport to the Express response.

4. **Token auth middleware** — Create middleware (likely
   `server/src/middleware/mcpAuth.ts`) that extracts the bearer token from the
   `Authorization` header, compares it to `MCP_DEFAULT_TOKEN` from environment,
   and on match looks up or creates an MCP bot user (`provider: 'mcp'`,
   `displayName: 'MCP Bot'`) attached to `req.user`. Returns 401 on missing
   or invalid token.

5. **Route registration** — Register `POST /api/mcp` in the Express app with
   the token auth middleware and MCP handler.

6. **Dependencies** — Install `@modelcontextprotocol/sdk` in `server/`.

7. **Secrets** — Add `MCP_DEFAULT_TOKEN` to `config/dev/secrets.env` and
   `config/prod/secrets.env`.

## Acceptance Criteria

- [ ] `server/src/mcp/server.ts` exists and exports `createMcpServer()`
- [ ] `server/src/mcp/context.ts` exports `runWithContext()` and `getContext()`
- [ ] `server/src/mcp/handler.ts` exports `createMcpHandler()` using `StreamableHTTPServerTransport`
- [ ] Token auth middleware validates `Authorization: Bearer <token>` against `MCP_DEFAULT_TOKEN`
- [ ] Missing or invalid token returns 401
- [ ] Valid token resolves MCP bot user (upsert with `provider: 'mcp'`)
- [ ] `POST /api/mcp` route is registered in the Express app
- [ ] `@modelcontextprotocol/sdk` is added to `server/package.json`
- [ ] `MCP_DEFAULT_TOKEN` is added to config secrets files
- [ ] Server compiles without errors (`cd server && npx tsc --noEmit`)

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Auth tests are covered in ticket #005
- **Verification command**: `cd server && npx tsc --noEmit`
