---
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 018 Use Cases

## SUC-018-001: Admin registers an OAuth client

- **Actor**: Admin user
- **Preconditions**: Admin signed in, on `/admin/oauth-clients`.
- **Main Flow**:
  1. Admin clicks "New OAuth Client".
  2. Admin fills in name, description, redirect URIs (text array), allowed scopes (text array).
  3. Server generates a `client_id` and a high-entropy `client_secret`. Stores `client_secret_hash` (SHA-256). Returns the new client with the plaintext secret.
  4. Client UI displays the secret in a "copy now, you won't see it again" modal.
- **Postconditions**: A new `OAuthClient` row exists. An audit event is written.
- **Acceptance Criteria**:
  - [ ] Plaintext secret is shown exactly once.
  - [ ] Re-fetching the client never returns the plaintext.

## SUC-018-002: External client mints an access token

- **Actor**: Registered third-party service
- **Preconditions**: A non-disabled `OAuthClient` exists. The service has its `client_id` and plaintext secret.
- **Main Flow**:
  1. Service POSTs to `/oauth/token` with `Authorization: Basic <base64(client_id:secret)>` (or form fields) and body `grant_type=client_credentials`. Optionally `scope=users:read`.
  2. Server validates the credentials (constant-time hash compare).
  3. Server mints a new access token, stores its hash, returns `{ access_token, token_type: 'Bearer', expires_in, scope }`.
  4. An audit event `oauth_token_issued` is written.
- **Postconditions**: A new `OAuthAccessToken` row exists with hash, scopes, expiry. The plaintext token is in the response only.
- **Acceptance Criteria**:
  - [ ] Wrong secret returns 401.
  - [ ] Disabled client returns 401.
  - [ ] Missing or invalid `grant_type` returns 400 with OAuth-spec error.
  - [ ] Successful response is shaped per the OAuth spec.

## SUC-018-003: External client calls the directory API

- **Actor**: Registered third-party service holding a valid bearer token.
- **Preconditions**: A non-revoked, non-expired `OAuthAccessToken` with `users:read` scope exists.
- **Main Flow**:
  1. Service calls `GET /v1/users` (or `/v1/users/:id`) with `Authorization: Bearer <token>`.
  2. `oauthBearer` middleware validates the token (hash lookup, expiry, revocation, scope).
  3. Middleware updates `last_used_at`.
  4. Route handler returns user list (or single user) with the documented field set.
- **Postconditions**: Token's `last_used_at` advanced. An audit event `oauth_directory_call` is written.
- **Acceptance Criteria**:
  - [ ] Missing token → 401.
  - [ ] Expired token → 401.
  - [ ] Revoked token → 401.
  - [ ] Token without `users:read` scope → 403.
  - [ ] Successful response excludes hash columns and any field marked sensitive in `User`.

## SUC-018-004: Admin rotates an OAuth client's secret

- **Actor**: Admin user
- **Preconditions**: An existing `OAuthClient`.
- **Main Flow**:
  1. Admin clicks "Rotate secret" on the client row.
  2. Server generates a new high-entropy secret, replaces the hash, returns the plaintext once.
  3. Old secret immediately stops working. Existing tokens minted with the old secret remain valid until expiry/revocation (acceptable; mirrors most OAuth providers).
  4. Audit event `oauth_client_secret_rotated` written.
- **Postconditions**: New hash stored; admin sees plaintext once.
- **Acceptance Criteria**:
  - [ ] After rotation, mint with the OLD secret returns 401.
  - [ ] After rotation, mint with the NEW secret succeeds.
