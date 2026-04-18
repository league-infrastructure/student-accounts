---
id: '007'
title: UI Shell & Chat Example Application
status: done
branch: sprint/007-ui-shell-chat-example-application
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
---

# Sprint 007: UI Shell & Chat Example Application

## Goals

Build the full application shell (AppLayout with sidebar navigation, search
bar, and user dropdown) and replace the Counter demo with a chat application
that exercises auth, user relationships, the service layer, and real-time
data display.

## Problem

The template's current UI is minimal: a flat page with `ExampleIntegrations.tsx`
and no application-wide layout. The only demo feature is a Counter that
increments and decrements an integer — it does not exercise authentication,
user relationships, or give agents and developers a meaningful example of
end-to-end data flow (model, service, API route, React page).

New projects cloned from this template have to build all their own navigation,
layout, and example plumbing from scratch.

## Solution

1. **AppLayout component** — a full application shell with a sidebar
   (logo + app name at top, navigation in the middle, MCP Setup and About
   at the bottom), a top bar (search input, user dropdown with name, role,
   Account, and Logout), and a content area for child routes. Mobile
   responsive with a hamburger toggle.

2. **AuthContext provider** — `useAuth()` hook that fetches `/api/auth/me`
   on mount and provides the current user, loading state, and logout
   function to the entire component tree.

3. **Roles library** — `client/src/lib/roles.ts` with role constants,
   display labels, `hasAdminAccess()` helper, and badge styles.

4. **Chat data model** — `Channel` and `Message` Prisma models with
   relations to the `User` model (from Sprint 005).

5. **Chat services** — `ChannelService` and `MessageService` registered
   in the ServiceRegistry (from Sprint 004).

6. **Chat API routes** — CRUD for channels and messages, with auth and
   admin guards.

7. **Chat UI** — `Chat.tsx` page with a channel list, message feed,
   message input, and polling for new messages. `Channels.tsx` admin
   page for creating and deleting channels.

8. **Counter removal** — delete the Counter model, CounterService, counter
   routes, and all related client code.

9. **Static pages** — `Home.tsx` landing page and `About.tsx` with app
   version display.

## Dependencies

- **Sprint 005 (Auth System & User Management)** — provides the `User`
  model, OAuth-to-DB upsert, role-based auth middleware, and
  `POST /api/auth/test-login`.
- **Sprint 006 (Admin Dashboard)** — provides the admin panel navigation
  items (Users, Environment, Configuration, Database, Logs, Sessions,
  Permissions, Backups, Scheduled Jobs, Integrations) that appear under
  the Admin section in the sidebar.

## Success Criteria

- `npm run dev` starts and displays the full AppLayout with sidebar
  navigation, search bar, and user dropdown
- Sidebar shows: Home, Chat, Admin (admin-only with sub-items), MCP Setup,
  About
- User dropdown displays "Eric Busboom" / "student" as default placeholder
- Chat page loads with a seeded `#general` channel
- Users can post messages and see them appear in the channel
- Messages from other users appear via polling without page refresh
- Admin users can create and delete channels
- Search bar performs debounced search and displays grouped results
- Counter model, service, routes, and client code are removed
- All chat API tests pass (`npm run test:server`)
- All client component tests pass (`npm run test:client`)
- Home and About pages render correctly

## Scope

### In Scope

- `AppLayout.tsx` component (sidebar, top bar, content area)
- Mobile-responsive sidebar with hamburger toggle
- `AuthContext.tsx` provider and `useAuth()` hook
- `client/src/lib/roles.ts` roles library
- Sidebar navigation: Home, Chat, Admin (admin-only with sub-items from
  Sprint 006), MCP Setup, About
- Default user display: "Eric Busboom" / "student"
- `Channel` and `Message` Prisma models and migration
- `ChannelService` (list, get, create, delete)
- `MessageService` (list with pagination, create, delete)
- Registration of both services in ServiceRegistry
- Chat API routes: `GET/POST /api/channels`, `GET/DELETE /api/channels/:id`,
  `POST /api/channels/:id/messages`, `DELETE /api/messages/:id`
- `Chat.tsx` page (channel list, message feed, input, polling)
- `Channels.tsx` admin page (create/delete channels)
- Seed `#general` channel on first run
- `Home.tsx` landing page
- `About.tsx` page with version display
- Search bar with debounced input, API endpoint, grouped results dropdown
- Remove Counter model, CounterService, counter routes, counter client code
- Server tests for all chat API routes
- Client tests for AppLayout, Chat page, sidebar navigation

### Out of Scope

- WebSocket or LISTEN/NOTIFY for real-time messages (polling only)
- MCP server integration (Sprint 008)
- Production Docker deployment (Sprint 009)
- File uploads or media in chat messages
- Direct messages or private channels
- Message editing
- Emoji reactions
- Typing indicators
- Read receipts

## Test Strategy

**Server tests** (`tests/server/`):
- Chat channel CRUD: list, create (admin), get with messages, delete (admin)
- Chat message CRUD: post (authenticated), delete (author or admin)
- Message pagination with `before` cursor
- Auth guards: 401 on unauthenticated, 403 on non-admin for admin routes
- Search endpoint: returns grouped results, respects min query length

**Client tests** (`tests/client/`):
- AppLayout renders sidebar with correct navigation items
- Admin nav items hidden for non-admin users
- User dropdown displays name and role
- Mobile hamburger toggle shows/hides sidebar
- Chat page renders channel list and message feed
- Message input submits and clears
- Channel creation/deletion in admin view

All tests use `POST /api/auth/test-login` for authentication (no mocked
sessions). Supertest agents maintain cookies across requests.

## Architecture Notes

See `architecture.md` for full details. Key decisions:

- **Polling, not WebSocket** — the chat uses a simple `setInterval` poll
  (every 3 seconds) to fetch new messages. This keeps the template simple
  and avoids WebSocket infrastructure. Real applications can upgrade to
  `LISTEN`/`NOTIFY` later.

- **Channel list inside content area** — the chat page has its own channel
  sidebar within the main content area, separate from the app-wide sidebar.
  This avoids nesting navigation confusion.

- **Search is server-side** — the search bar sends a debounced query to
  `GET /api/search?q=...` and the server searches across channels and
  messages, returning results grouped by type.

- **Counter removal is a clean break** — the Counter model is dropped via
  migration, and all related code is deleted. No backward compatibility
  concern since this is a template.

LOCAL DEV ONLY. This sprint is verified with `npm run dev`. Production
deployment is deferred to Sprint 009.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [ ] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [ ] Architecture review passed
- [ ] Stakeholder has approved the sprint plan

## Tickets

1. **001** — Create AuthContext and roles library
2. **002** — Build AppLayout component
3. **003** — Add Channel and Message models and services
4. **004** — Create chat API routes
5. **005** — Build chat UI pages
6. **006** — Create Home/About pages and update routing
7. **007** — Remove counter demo
8. **008** — Write chat and UI tests
