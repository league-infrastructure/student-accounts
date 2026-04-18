---
id: '002'
title: Implement MCP tools
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
depends-on:
- '001'
---

# Implement MCP tools

## Description

Create the MCP tool definitions in `server/src/mcp/tools.ts` and register
them with the McpServer. Each tool uses a Zod input schema and an async
handler that accesses the ServiceRegistry via `getContext()` from the
AsyncLocalStorage context established in ticket #001.

### Changes

1. **`server/src/mcp/tools.ts`** — Create and export a `registerTools(server)`
   function that registers all tools on the McpServer instance:

   | Tool | Input Schema | Service Call | Returns |
   |------|-------------|-------------|---------|
   | `get_version` | (none) | N/A | App version string from package.json |
   | `list_users` | (none) | `userService.list()` | Array of users |
   | `list_channels` | (none) | `channelService.list()` | Array of channels |
   | `get_channel_messages` | `{ channelId: z.number(), limit?: z.number() }` | `messageService.list(channelId, { limit })` | Array of messages with author info |
   | `post_message` | `{ channelId: z.number(), content: z.string() }` | `messageService.create(channelId, userId, content)` | Created message |
   | `create_channel` | `{ name: z.string(), description?: z.string() }` | `channelService.create(name, description)` | Created channel |

2. **`server/src/mcp/server.ts`** — Update to call `registerTools(server)`
   during McpServer creation.

Each tool handler follows the pattern:
- Call `getContext()` to get `{ user, services }`
- Call the appropriate service method
- Return `{ content: [{ type: 'text', text: JSON.stringify(result, null, 2) }] }`
- Handle errors gracefully (e.g., invalid channelId returns error in tool response)

Write tools (`post_message`, `create_channel`) use `user.id` from context
for attribution, ensuring all MCP writes are attributed to the MCP bot user.

## Acceptance Criteria

- [ ] `tools.ts` exports `registerTools(server)` function
- [ ] `get_version` tool returns the app version string
- [ ] `list_users` tool returns all users via `userService.list()`
- [ ] `list_channels` tool returns all channels via `channelService.list()`
- [ ] `get_channel_messages` tool accepts `channelId` and optional `limit`, returns messages with author info
- [ ] `post_message` tool creates a message attributed to the MCP bot user
- [ ] `create_channel` tool creates a channel with name and optional description
- [ ] All tools use Zod schemas for input validation
- [ ] All tools access services via `getContext()`, never via raw Prisma calls
- [ ] Invalid inputs (e.g., non-existent channelId) return meaningful error responses
- [ ] Server compiles without errors (`cd server && npx tsc --noEmit`)

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Tool-level tests are covered in ticket #005
- **Verification command**: `cd server && npx tsc --noEmit`
