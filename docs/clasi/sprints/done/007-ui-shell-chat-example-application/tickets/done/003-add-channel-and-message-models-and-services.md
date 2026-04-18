---
id: '003'
title: Add Channel and Message models and services
status: todo
use-cases:
- SUC-002
- SUC-003
- SUC-004
depends-on: []
---

# Add Channel and Message models and services

## Description

Add the Channel and Message Prisma models, create corresponding service
classes, and register them in the ServiceRegistry. This provides the data
layer for the chat example application.

### Changes

1. **`server/prisma/schema.prisma`**:
   - Add `Channel` model: id (autoincrement), name (unique), description
     (optional), createdAt, updatedAt, messages relation
   - Add `Message` model: id (autoincrement), content, channelId (FK to
     Channel with onDelete Cascade), authorId (FK to User), createdAt,
     updatedAt
   - Add `messages Message[]` relation field to the existing `User` model

2. **Run Prisma migration**: `npx prisma migrate dev --name add-channel-message`

3. **`server/src/services/channel.service.ts`**:
   - `list()`: Returns all channels with a `messageCount` (using `_count`)
   - `get(id, options?)`: Returns channel with paginated messages (newest
     first, cursor-based via `before` message ID, configurable `limit`)
   - `create(name, description?)`: Validates unique name, creates channel
   - `delete(id)`: Deletes channel (messages cascade-delete via relation)

4. **`server/src/services/message.service.ts`**:
   - `list(channelId, options?)`: Returns messages for a channel with
     author info (displayName, avatarUrl), ordered by createdAt ascending,
     cursor-based pagination via `before` message ID
   - `create(channelId, authorId, content)`: Validates channel and author
     exist, creates message
   - `delete(id)`: Removes a single message

5. **Register in ServiceRegistry**: Add `ChannelService` and
   `MessageService` to `server/src/services/service.registry.ts`

6. **Seed `#general` channel**: Add seed logic (via Prisma seed or
   migration data seed) to create a `#general` channel on first run

## Acceptance Criteria

- [ ] `Channel` model exists in Prisma schema with id, name (unique),
      description, createdAt, updatedAt, messages relation
- [ ] `Message` model exists with id, content, channelId (FK, cascade
      delete), authorId (FK to User), createdAt, updatedAt
- [ ] `User` model has `messages Message[]` relation field
- [ ] Prisma migration runs successfully
- [ ] `ChannelService` implements list (with count), get (with paginated
      messages), create, and delete
- [ ] `MessageService` implements list (paginated with author info),
      create, and delete
- [ ] Both services are registered in ServiceRegistry
- [ ] `#general` channel is seeded on first run
- [ ] `npx prisma migrate dev` completes without errors
- [ ] Existing tests pass: `npm run test:server`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **New tests to write**: Deferred to ticket 008 (Write chat and UI tests)
- **Verification command**: `npm run test:server`
