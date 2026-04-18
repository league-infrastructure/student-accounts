---
status: approved
---

# Sprint 008 Use Cases

## SUC-001: External MCP client authenticates with token and calls a tool
Parent: N/A (infrastructure)

- **Actor**: External MCP client (Claude Desktop, Claude Code, custom client)
- **Preconditions**: App is running, `MCP_DEFAULT_TOKEN` is configured,
  at least one channel exists in the database
- **Main Flow**:
  1. Client sends `POST /api/mcp` with `Authorization: Bearer <token>`
     and an MCP tool call request (e.g., `list_channels`)
  2. Auth middleware validates the bearer token against `MCP_DEFAULT_TOKEN`
  3. Handler creates a ServiceRegistry with source `'MCP'` and wraps
     execution in AsyncLocalStorage context
  4. `StreamableHTTPServerTransport` deserializes the MCP request and
     dispatches to the registered tool handler
  5. Tool handler calls `getContext()`, accesses `services.channelService`,
     and returns the channel list
  6. Response is serialized and returned to the client
- **Postconditions**: Client receives a well-formed MCP response with
  the tool result
- **Acceptance Criteria**:
  - [ ] Valid bearer token + tool call returns 200 with MCP response
  - [ ] Missing token returns 401
  - [ ] Invalid token returns 401
  - [ ] Tool result contains expected data from the database

## SUC-002: MCP bot posts a message to a chat channel
Parent: N/A (infrastructure)

- **Actor**: External MCP client
- **Preconditions**: App is running, valid MCP token configured, at least
  one channel exists, MCP bot user exists or is auto-created
- **Main Flow**:
  1. Client sends `POST /api/mcp` with a `post_message` tool call
     containing `channelId` and `content` parameters
  2. Auth middleware validates the token and resolves the MCP bot user
  3. Tool handler calls `getContext()` and uses
     `services.messageService.create(channelId, botUserId, content)`
  4. Message is persisted in the database with the bot user as author
  5. Tool returns a confirmation with the created message details
- **Postconditions**: New message exists in the database attributed to
  the MCP bot user; message appears in the channel's message feed
- **Acceptance Criteria**:
  - [ ] `post_message` tool call creates a message in the database
  - [ ] Message `authorId` matches the MCP bot user
  - [ ] Message appears when querying `GET /api/channels/:id`
  - [ ] Invalid `channelId` returns an error in the tool response

## SUC-003: MCP client lists channels and reads messages
Parent: N/A (infrastructure)

- **Actor**: External MCP client
- **Preconditions**: App is running, valid MCP token, channels with
  messages exist
- **Main Flow**:
  1. Client calls `list_channels` tool — receives list of all channels
     with names and descriptions
  2. Client calls `get_channel_messages` tool with a `channelId` parameter
     — receives recent messages for that channel with author info and
     timestamps
- **Postconditions**: Client has read-only access to channel and message
  data through MCP tools
- **Acceptance Criteria**:
  - [ ] `list_channels` returns all channels with id, name, description
  - [ ] `get_channel_messages` returns messages with content, author
    display name, and timestamp
  - [ ] `get_channel_messages` with invalid channelId returns an error
  - [ ] Messages are returned in chronological order

## SUC-004: Developer visits MCP Setup page for configuration instructions
Parent: N/A (infrastructure)

- **Actor**: Developer or admin user
- **Preconditions**: App is running, user is authenticated
- **Main Flow**:
  1. User clicks "MCP Setup" in the sidebar navigation
  2. MCP Setup page loads showing the app's MCP endpoint URL
  3. Page displays token configuration instructions (where to set
     `MCP_DEFAULT_TOKEN`)
  4. Page shows an example client configuration snippet for Claude Desktop
     (JSON config with endpoint URL and token header)
  5. User copies the configuration and pastes it into their MCP client
- **Postconditions**: User has all the information needed to connect an
  external MCP client to the application
- **Acceptance Criteria**:
  - [ ] MCP Setup page is accessible from the sidebar
  - [ ] Page displays the correct MCP endpoint URL
  - [ ] Page includes token configuration instructions
  - [ ] Page shows a copy-ready example client config snippet

## SUC-005: New developer reads updated docs and sets up the project
Parent: N/A (infrastructure)

- **Actor**: New developer
- **Preconditions**: Developer has cloned the repository, has Docker
  installed
- **Main Flow**:
  1. Developer reads `docs/setup.md` for first-time setup instructions
  2. Setup guide accurately describes the `config/` directory structure,
     SOPS decryption, and `npm run dev` workflow
  3. Developer reads `docs/template-spec.md` for architecture overview
  4. Spec accurately describes the service layer, MCP server, auth system,
     admin dashboard, and chat example app
  5. Developer reads `docs/secrets.md` for secrets management
  6. Secrets guide accurately describes the `config/` layout with
     `public.env` / `secrets.env` split
  7. Developer reads `AGENTS.md` for AI agent development guidelines
  8. AGENTS.md includes service layer guidance (business logic in services,
     routes are thin adapters, register in ServiceRegistry)
- **Postconditions**: Developer has an accurate, consistent picture of
  the template architecture and can begin development
- **Acceptance Criteria**:
  - [ ] `docs/setup.md` reflects the current first-time setup flow
  - [ ] `docs/template-spec.md` documents config, service layer, MCP,
    Docker, and admin features
  - [ ] `docs/secrets.md` documents the `config/` directory migration
  - [ ] `docs/deployment.md` documents the current Docker model
  - [ ] `docs/testing.md` reflects current test patterns
  - [ ] `AGENTS.md` includes service layer guidance for agents
  - [ ] No documentation references stale paths or removed features
