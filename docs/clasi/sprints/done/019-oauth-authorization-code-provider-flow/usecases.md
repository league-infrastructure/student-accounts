---
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 019 Use Cases

## SUC-019-001: External app authenticates user via authorization-code + PKCE

- **Actor**: External application (third-party client) and end user
- **Preconditions**: A non-disabled `OAuthClient` exists with the requested `redirect_uri` registered. The end user has an account in this app.
- **Main Flow**:
  1. External app sends user's browser to `GET /oauth/authorize?response_type=code&client_id=...&redirect_uri=...&scope=profile&state=...&code_challenge=...&code_challenge_method=S256`.
  2. If user not signed in, server redirects to `/login?next=<encoded-authorize-url>`. After successful login, browser returns to the authorize URL.
  3. If consent is not on file, server renders `/oauth/consent` showing the client name + requested scopes.
  4. User clicks Allow. Browser POSTs `/oauth/authorize/consent`.
  5. Server records consent, mints `OAuthAuthorizationCode`, redirects browser to `redirect_uri?code=...&state=...`.
  6. External app exchanges the code: `POST /oauth/token` with `grant_type=authorization_code&code=...&redirect_uri=...&code_verifier=...`. Server validates code (single-use, expiry, redirect_uri match, PKCE), mints access + refresh tokens, marks code consumed. Response: `{ access_token, token_type: 'Bearer', expires_in, refresh_token, scope }`.
  7. External app calls `GET /oauth/userinfo` with `Authorization: Bearer <access_token>`. Returns `{ sub, email, name, role }`.
- **Postconditions**: External app has authenticated identity for the user. Audit events written for authorize-attempt, consent-granted, code-issued, code-consumed, userinfo-call.
- **Acceptance Criteria**:
  - [ ] Round trip succeeds with valid PKCE.
  - [ ] Wrong `code_verifier` → 400 `invalid_grant`.
  - [ ] Replayed code → 400 `invalid_grant`.
  - [ ] Mismatched `redirect_uri` between authorize and token → 400.
  - [ ] Disabled client cannot mint codes (401).

## SUC-019-002: User denies consent

- **Actor**: End user
- **Preconditions**: Authorize endpoint reached the consent screen.
- **Main Flow**:
  1. User clicks Deny.
  2. Server redirects to `redirect_uri?error=access_denied&state=...`.
  3. No consent recorded; no code minted.
- **Acceptance Criteria**:
  - [ ] Browser lands at `redirect_uri` with `error=access_denied` query param.

## SUC-019-003: Refresh-token rotation

- **Actor**: External application holding a valid refresh token.
- **Preconditions**: Access token has expired (or app pre-emptively rotates).
- **Main Flow**:
  1. App POSTs `/oauth/token` with `grant_type=refresh_token&refresh_token=...&client_id=...&client_secret=...` (confidential clients only — public clients pass `client_id` only and are out of scope this sprint).
  2. Server validates the refresh token (hash lookup, expiry, revocation, client matches).
  3. Server mints a new access token AND a new refresh token; marks the old refresh token's `replaced_by_id` to the new one's id.
  4. Response: same shape as authorization-code.
- **Postconditions**: Old refresh token cannot be used again.
- **Acceptance Criteria**:
  - [ ] Replaying the OLD refresh token after rotation returns 400 AND revokes the entire chain (security defense).
  - [ ] New refresh token works for one rotation; then it too is replaced.
  - [ ] Refresh from a disabled client returns 401.

## SUC-019-004: Localhost redirect URI on any port

- **Actor**: Developer running a local CLI/dev tool.
- **Preconditions**: An `OAuthClient` has registered `http://localhost:8080/callback` as a redirect URI.
- **Main Flow**:
  1. Developer starts their tool on `localhost:5555`.
  2. Tool sends user to `/oauth/authorize?...&redirect_uri=http://localhost:5555/callback`.
  3. Server's redirect-matcher: `localhost:5555` is `localhost`, registered host is `localhost`, paths match (`/callback`). → matches.
  4. Flow proceeds normally.
- **Postconditions**: Same as SUC-019-001.
- **Acceptance Criteria**:
  - [ ] Any localhost port matches a registered localhost URL with the same path.
  - [ ] Localhost path mismatch → 400.
  - [ ] Non-localhost different port → 400.
  - [ ] `localhostfake.com` does NOT match `localhost`.
