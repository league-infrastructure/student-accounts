---
id: 008
title: Manual smoke pass stakeholder verification sweep
status: done
use-cases:
- SUC-018-001
- SUC-018-002
- SUC-018-003
- SUC-018-004
depends-on:
- '001'
- '002'
- '003'
- '004'
- '005'
- '006'
- '007'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke pass stakeholder verification sweep

## Description

End-to-end manual verification of the full sprint-018 flow against a
running dev server. This is the stakeholder gate: every claim in
`sprint.md` "Success Criteria" should be reachable from this checklist.
Reference `usecases.md` for the four use cases the smoke covers.

The intent is to exercise the system the way an external integration
will: register a client through the UI, mint a token from a terminal,
hit `/v1/users` with the token, then disable the client and confirm
calls fail.

## Acceptance Criteria

- [ ] Dev server is running (`npm run dev` or rundbat-up dev) and admin user is signed in.
- [ ] Open `/account`; the new "OAuth Clients" admin tile appears.
- [ ] Open `/admin/oauth-clients` from the tile; the page loads with an empty (or existing) list.
- [ ] Click "New OAuth Client". Fill name, description, one redirect URI, scopes including `users:read`. Submit.
- [ ] The plaintext `client_secret` is displayed in the one-time modal. Copy button works. Save the `client_id` and secret to a scratch buffer.
- [ ] Dismiss the modal; the new client appears in the list.
- [ ] From a terminal:
      `curl -u <client_id>:<secret> -d grant_type=client_credentials http://localhost:5201/oauth/token`
      returns a JSON body with `access_token`, `token_type: "Bearer"`, `expires_in: 3600`, and `scope`.
- [ ] `curl -H "Authorization: Bearer <token>" http://localhost:5201/v1/users` returns a paginated user list with the documented fields.
- [ ] `curl -H "Authorization: Bearer <token>" http://localhost:5201/v1/users/<id>` returns the single record with `cohort_id` and `created_at`.
- [ ] `curl http://localhost:5201/v1/users` (no token) returns 401.
- [ ] In the admin DB / audit-log view, confirm rows for `oauth_client_created`, `oauth_token_issued`, and `oauth_directory_call`.
- [ ] In the UI click "Rotate" on the client. New plaintext appears in the one-time modal. The old token still works (acceptable, per usecases.md SUC-018-004), but minting with the OLD secret returns 401.
- [ ] Click "Disable" on the client. Both `POST /oauth/token` (with either secret) and `GET /v1/users` (with any previously-issued token from this client) return 401.
- [ ] No plaintext secret appears in server logs at any step.

## Testing

- **Existing tests to run**: `npm run test:server && npm run test:client` (must be green before starting the smoke pass)
- **New tests to write**: None — this ticket is manual verification only.
- **Verification command**: `npm run test:server && npm run test:client` (then perform the checklist above by hand)
