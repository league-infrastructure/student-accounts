---
status: approved
---

# Sprint 007 Use Cases

## SUC-001: User sees sidebar with navigation after login
Parent: N/A (UI shell)

- **Actor**: Authenticated user
- **Preconditions**: User is logged in, AppLayout is rendered
- **Main Flow**:
  1. User navigates to any page in the application
  2. AppLayout renders the sidebar with the application logo and name at
     the top
  3. Navigation items appear in the middle section: Home, Chat, and
     (for admin users) an Admin group with sub-items
  4. MCP Setup and About links appear at the bottom of the sidebar
  5. User clicks a navigation item and is routed to the corresponding page
- **Postconditions**: User is on the selected page with the sidebar still
  visible and the active item highlighted
- **Acceptance Criteria**:
  - [ ] Sidebar displays logo/flag icon and application name at the top
  - [ ] Home and Chat links are visible to all authenticated users
  - [ ] Admin section with sub-items (Users, Environment, Configuration,
        Database, Logs, Sessions, Permissions, Backups, Scheduled Jobs,
        Integrations) is visible only to admin users
  - [ ] MCP Setup and About links appear at the bottom of the sidebar
  - [ ] Active navigation item is visually highlighted
  - [ ] On mobile, sidebar is hidden by default and toggled via hamburger icon

## SUC-002: User sends a message in a chat channel
Parent: N/A (chat example)

- **Actor**: Authenticated user
- **Preconditions**: User is logged in, at least one channel exists
  (e.g., `#general` seeded on first run)
- **Main Flow**:
  1. User navigates to the Chat page
  2. Channel list appears on the left side of the content area
  3. User selects the `#general` channel
  4. Message feed displays existing messages with author name, avatar, and
     timestamp
  5. User types a message in the input at the bottom and presses Enter
     (or clicks Send)
  6. Message is posted via `POST /api/channels/:id/messages`
  7. Message appears immediately in the feed
- **Postconditions**: Message is persisted in the database and visible in
  the channel feed
- **Acceptance Criteria**:
  - [ ] Message input is visible at the bottom of the chat area
  - [ ] Pressing Enter or clicking Send posts the message
  - [ ] Input clears after successful send
  - [ ] New message appears in the feed with the current user as author
  - [ ] Message shows author display name, avatar (or placeholder), and
        timestamp
  - [ ] Empty messages are not sent (input validation)

## SUC-003: User sees messages from other users via polling
Parent: N/A (chat example)

- **Actor**: Authenticated user
- **Preconditions**: User is on the Chat page viewing a channel, another
  user has posted a message in the same channel
- **Main Flow**:
  1. User is viewing a channel's message feed
  2. Another user posts a message to the same channel (via API or another
     browser session)
  3. The polling interval fires (every 3 seconds)
  4. Client fetches new messages from `GET /api/channels/:id`
  5. New messages appear in the feed without a page refresh
- **Postconditions**: All messages in the channel are visible, including
  those from other users
- **Acceptance Criteria**:
  - [ ] New messages from other users appear within one polling cycle
        (~3 seconds)
  - [ ] Message feed auto-scrolls to the newest message when new messages
        arrive (if the user is already at the bottom)
  - [ ] Messages maintain chronological order
  - [ ] Polling does not cause duplicate messages in the feed
  - [ ] No full page refresh is required

## SUC-004: Admin creates and deletes a channel
Parent: N/A (chat example)

- **Actor**: Admin user
- **Preconditions**: User is logged in with an admin role
- **Main Flow (create)**:
  1. Admin navigates to the Channels admin page
  2. Admin enters a channel name and optional description
  3. Admin clicks Create
  4. Channel is created via `POST /api/channels`
  5. New channel appears in the channel list
- **Main Flow (delete)**:
  1. Admin navigates to the Channels admin page
  2. Admin clicks the delete button on an existing channel
  3. Confirmation dialog appears
  4. Admin confirms deletion
  5. Channel and all its messages are deleted via `DELETE /api/channels/:id`
  6. Channel is removed from the list
- **Postconditions**: Channel is created or deleted in the database;
  associated messages are cascade-deleted on channel removal
- **Acceptance Criteria**:
  - [ ] Only admin users can access the Channels admin page
  - [ ] Creating a channel with a unique name succeeds
  - [ ] Creating a channel with a duplicate name shows an error
  - [ ] Deleting a channel removes it and all its messages
  - [ ] Non-admin users receive 403 on create/delete API calls
  - [ ] Newly created channels appear in the Chat page channel list

## SUC-005: User searches for content via the search bar
Parent: N/A (UI shell)

- **Actor**: Authenticated user
- **Preconditions**: User is logged in, AppLayout top bar is visible
- **Main Flow**:
  1. User clicks the search input in the top bar
  2. User types a query (minimum 2 characters)
  3. After a 300ms debounce, the client sends `GET /api/search?q=...`
  4. Server searches across channels and messages
  5. Results dropdown appears below the search bar, grouped by type
     (Channels, Messages)
  6. User clicks a result and is navigated to the corresponding page
- **Postconditions**: User is on the page for the selected search result
- **Acceptance Criteria**:
  - [ ] Search input is visible in the top bar
  - [ ] No search is triggered for queries shorter than 2 characters
  - [ ] Search is debounced at 300ms to avoid excessive API calls
  - [ ] Results are grouped by type (Channels, Messages)
  - [ ] Clicking a channel result navigates to that channel in the Chat page
  - [ ] Clicking a message result navigates to the channel containing that
        message
  - [ ] Empty results show a "No results found" message

## SUC-006: User accesses account settings from the user dropdown
Parent: N/A (UI shell)

- **Actor**: Authenticated user
- **Preconditions**: User is logged in, AppLayout top bar is visible
- **Main Flow**:
  1. User sees their display name and role in the upper-right corner of
     the top bar
  2. User clicks the user area to open the dropdown menu
  3. Dropdown shows: display name, role label, Account link, Logout link
  4. User clicks Account to navigate to account settings
  5. User clicks Logout to end the session
- **Postconditions**: User is on the Account page, or logged out and
  redirected to the login page
- **Acceptance Criteria**:
  - [ ] User display area shows name and role (default: "Eric Busboom" /
        "student")
  - [ ] Clicking the user area opens a dropdown menu
  - [ ] Dropdown contains Account and Logout options
  - [ ] Clicking Account navigates to the account settings page
  - [ ] Clicking Logout calls `POST /api/auth/logout` and redirects to login
  - [ ] Dropdown closes when clicking outside

## SUC-007: Visitor sees the About page with app version
Parent: N/A (UI shell)

- **Actor**: Authenticated user
- **Preconditions**: User is logged in, About link is visible in the sidebar
- **Main Flow**:
  1. User clicks "About" in the sidebar
  2. About page loads and displays the application name, version, and
     basic information
- **Postconditions**: User sees the About page content
- **Acceptance Criteria**:
  - [ ] About page is accessible from the sidebar
  - [ ] Page displays the application name
  - [ ] Page displays the current application version (from package.json
        or environment)
  - [ ] Page renders without errors
