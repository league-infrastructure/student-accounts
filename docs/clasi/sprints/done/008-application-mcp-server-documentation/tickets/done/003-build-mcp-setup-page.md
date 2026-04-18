---
id: '003'
title: Build MCP Setup page
status: done
use-cases:
- SUC-004
depends-on:
- '001'
---

# Build MCP Setup page

## Description

Create a client-side MCP Setup page that provides developers with all the
information needed to connect external MCP clients to the application. The
page is accessible from the sidebar navigation and displays the endpoint URL,
token configuration instructions, and copy-ready example configuration
snippets.

### Changes

1. **`client/src/pages/McpSetup.tsx`** — Create the MCP Setup page component
   displaying:
   - The application's MCP endpoint URL (`https://<domain>/api/mcp` or
     `http://localhost:3000/api/mcp` for local dev)
   - Instructions for setting the `MCP_DEFAULT_TOKEN` environment variable
     in `config/dev/secrets.env`
   - Example Claude Desktop configuration snippet (JSON) showing how to
     configure the MCP server with the endpoint URL and authorization header
   - Example `curl` command for testing the endpoint manually
   - Brief explanation of available tools (list from ticket #002)

2. **Sidebar navigation** — Add an "MCP Setup" link to the sidebar nav
   component, routed to the McpSetup page.

3. **Router** — Add the route for the MCP Setup page in the client router
   configuration.

## Acceptance Criteria

- [ ] `client/src/pages/McpSetup.tsx` exists and renders correctly
- [ ] MCP Setup page is accessible from the sidebar navigation
- [ ] Page displays the MCP endpoint URL
- [ ] Page includes token configuration instructions
- [ ] Page shows a copy-ready Claude Desktop configuration snippet
- [ ] Page shows an example `curl` command for testing
- [ ] Page lists the available MCP tools with brief descriptions
- [ ] Client compiles without errors (`cd client && npx tsc --noEmit`)

## Testing

- **Existing tests to run**: `npm run test:client` to verify no regressions
- **New tests to write**: Component render test verifying key content is
  displayed (endpoint URL, config snippet, tool list)
- **Verification command**: `cd client && npx tsc --noEmit`
