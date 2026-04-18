---
status: draft
---

# Sprint 005 Use Cases

## SUC-001: User logs in via OAuth and User record is created or updated
Parent: N/A (auth infrastructure)

- **Actor**: User (any role)
- **Preconditions**: App is running, GitHub or Google OAuth is configured,
  user has a valid OAuth account
- **Main Flow**:
  1. User clicks "Login with GitHub" or "Login with Google"
  2. Browser redirects to the OAuth provider
  3. User authenticates with the provider and grants access
  4. Provider redirects back to the app callback URL
  5. Passport OAuth callback fires with profile data
  6. Server upserts a User record matching provider + providerId
  7. User record fields (email, displayName, avatarUrl) are updated
     from the latest OAuth profile
  8. Session is created with the user's database ID
  9. User is redirected to the app
- **Postconditions**: User record exists in database with current profile
  data; session contains user ID; subsequent requests load full User
  from database
- **Acceptance Criteria**:
  - [ ] First OAuth login creates a new User record in the database
  - [ ] Repeat OAuth login updates existing User record (same provider +
    providerId)
  - [ ] User record contains email, displayName, avatarUrl, provider,
    and providerId
  - [ ] New users default to USER role
  - [ ] Session stores user ID (not full profile object)
  - [ ] `GET /api/auth/me` returns the full User record after login

## SUC-002: Admin views and manages users in admin panel
Parent: N/A (admin infrastructure)

- **Actor**: Admin user
- **Preconditions**: User is logged in with ADMIN role, admin panel is
  accessible
- **Main Flow**:
  1. Admin navigates to the Users panel in the admin dashboard
  2. Panel loads and displays a table of all users
  3. Table shows email, displayName, role, provider, and timestamps
  4. Admin can create a new user by providing email and role
  5. Admin can edit an existing user's details (displayName, role)
  6. Admin can delete a user (with confirmation dialog)
- **Postconditions**: User records in the database reflect the admin's
  changes
- **Acceptance Criteria**:
  - [ ] Users panel displays all users in a table
  - [ ] Admin can create a new user with email and role
  - [ ] Admin can edit a user's displayName and role
  - [ ] Admin can delete a user after confirming
  - [ ] Changes are persisted to the database
  - [ ] Table refreshes after create/edit/delete operations

## SUC-003: Admin changes a user's role
Parent: N/A (auth infrastructure)

- **Actor**: Admin user
- **Preconditions**: User is logged in with ADMIN role, target user
  exists in the database
- **Main Flow**:
  1. Admin opens the Users panel
  2. Admin locates the target user in the table
  3. Admin changes the user's role from USER to ADMIN (or vice versa)
  4. Admin saves the change
  5. Server updates the User record's role field
  6. The change takes effect on the target user's next request (session
     deserialization loads updated role from DB)
- **Postconditions**: User's role is updated in the database; the user's
  permissions change on their next request
- **Acceptance Criteria**:
  - [ ] Admin can change a user's role via the admin panel
  - [ ] Role change is persisted to the database
  - [ ] Updated role is reflected in `GET /api/auth/me` for the affected
    user
  - [ ] Admin cannot demote themselves if they are the last admin (guard
    against lockout)

## SUC-004: Non-admin user is blocked from admin routes
Parent: N/A (auth infrastructure)

- **Actor**: User with USER role
- **Preconditions**: User is logged in with USER role
- **Main Flow**:
  1. User (or client code) sends a request to an admin route
     (e.g., `GET /api/admin/users`)
  2. `requireAdmin()` middleware checks the user's role
  3. Middleware finds role is USER, not ADMIN
  4. Server responds with 403 Forbidden
- **Postconditions**: Admin resource is not accessed; 403 response is
  returned
- **Acceptance Criteria**:
  - [ ] `GET /api/admin/users` returns 403 for USER role
  - [ ] `POST /api/admin/users` returns 403 for USER role
  - [ ] `PUT /api/admin/users/:id` returns 403 for USER role
  - [ ] `DELETE /api/admin/users/:id` returns 403 for USER role
  - [ ] Unauthenticated requests return 401, not 403
  - [ ] Response body includes `{ error: "Forbidden" }` or similar

## SUC-005: Developer uses test-login endpoint in tests
Parent: N/A (test infrastructure)

- **Actor**: Developer (running automated tests)
- **Preconditions**: App is running in test or development environment
  (`NODE_ENV` is `test` or `development`)
- **Main Flow**:
  1. Test sends `POST /api/auth/test-login` with `{ email, role? }`
  2. Server checks that `NODE_ENV` is not `production`
  3. Server creates or finds a User with the given email
  4. If `role` is provided, user is created/updated with that role
     (defaults to USER)
  5. Session is created with the user's database ID
  6. Server responds with the User record and session cookie
  7. Subsequent requests using the same agent/cookie jar are
     authenticated as that user
- **Postconditions**: Test has an authenticated session without needing
  OAuth; User record exists in database
- **Acceptance Criteria**:
  - [ ] `POST /api/auth/test-login` with `{ email: "test@example.com" }`
    creates session and returns user
  - [ ] `POST /api/auth/test-login` with `{ email: "admin@example.com",
    role: "ADMIN" }` creates an admin user session
  - [ ] Endpoint is disabled when `NODE_ENV=production` (returns 404)
  - [ ] Supertest agent retains session cookie for subsequent requests
  - [ ] Multiple test-logins with same email reuse the existing User
    record
