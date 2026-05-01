---
id: "010"
title: "Consent page client OAuthConsent.tsx"
status: todo
use-cases:
  - SUC-019-001
  - SUC-019-002
depends-on:
  - "005"
  - "006"
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Consent page client OAuthConsent.tsx

## Description

Create `client/src/pages/OAuthConsent.tsx` per
`architecture-update.md` § "New Modules (Client)" and `sprint.md` §
Solution step 7. This is the screen the user sees when
`GET /oauth/authorize` (ticket 005) determines consent is needed.

**URL params** (read with `useSearchParams` or `URLSearchParams`):

- `client_id`
- `redirect_uri`
- `scope` (space-separated) — also accept `scopes` if ticket 005 ends
  up using that name; pick one and align both.
- `state`
- `code_challenge`
- `code_challenge_method`

**Client metadata fetch.** The page needs the client's display name +
description to render. Two implementation paths — pick the simpler
one:

1. **Public metadata endpoint** — add `GET /api/oauth-clients/:client_id/public`
   returning `{ name, description, allowed_scopes }` (no secrets, no
   audit fields). This route does NOT exist yet — if you go this
   route, add it as part of this ticket's work, mounted alongside the
   admin OAuth-clients routes from sprint 018, but without auth.
2. **Round-trip via the redirect from `/oauth/authorize`** — have
   ticket 005 stuff the client name + description into the
   `/oauth/consent?...` redirect query. Simpler, no new API surface.

The implementer chooses; document the chosen path in the ticket's PR
description.

**UI:**

- Show the requesting client's `name` (header) and `description`
  (body).
- Show the requested scopes as chips with human-readable labels.
  Maintain the label map in one place (e.g. `client/src/lib/oauth-scopes.ts`):
  - `profile` → "Your basic profile (name, email, role)"
  - `users:read` → "Read directory of users"
  - Add entries for any other scopes already in the codebase.
- "Allow" and "Deny" buttons.

**Form submission — IMPORTANT.** Submit as a real HTML form POST to
`/oauth/authorize/consent`, NOT as a `fetch` call. The server's
response is a 302 redirect to `redirect_uri?...` and only a top-level
form navigation lets the browser follow it back to the third-party
app. A fetch redirect would land back inside the SPA.

```jsx
<form method="POST" action="/oauth/authorize/consent">
  <input type="hidden" name="client_id" value={clientId} />
  <input type="hidden" name="redirect_uri" value={redirectUri} />
  <input type="hidden" name="scopes" value={scopes.join(' ')} />
  <input type="hidden" name="state" value={state} />
  <input type="hidden" name="code_challenge" value={codeChallenge} />
  <input type="hidden" name="code_challenge_method" value={codeChallengeMethod} />
  {/* CSRF token if the existing app uses one */}
  <button name="decision" value="allow">Allow</button>
  <button name="decision" value="deny">Deny</button>
</form>
```

Both buttons share the form so all hidden fields round-trip; the
server reads `decision` from the clicked button's value.

**Routing.** Add a route for `/oauth/consent` in
`client/src/App.tsx` (or wherever the router is configured), pointing
at the new page. The route must be public (no auth-gate redirect) —
authentication for this flow is handled at `/oauth/authorize`, and
this page receives the user already-logged-in.

## Acceptance Criteria

- [ ] `client/src/pages/OAuthConsent.tsx` exists.
- [ ] Route `/oauth/consent` registered in `client/src/App.tsx`.
- [ ] Page reads all six query params.
- [ ] Client metadata (name, description) is rendered — via either the new public endpoint or the round-tripped query params.
- [ ] Scope chips with human-readable labels render for all requested scopes.
- [ ] Allow and Deny buttons submit a real HTML form POST to `/oauth/authorize/consent` with all params round-tripped as hidden fields and `decision` from the clicked button.
- [ ] No `fetch` calls for the consent submission (otherwise the cross-origin redirect breaks).

## Testing

- **Existing tests to run**: `npm run test:client`, `npm run test:server`
- **New tests to write**:
  - `client/src/pages/OAuthConsent.test.tsx`:
    - Renders client name + description from props/query.
    - Renders scope chips with the right labels for `profile` and `users:read`.
    - Submitting "Allow" includes all six round-trip hidden fields with the right values plus `decision=allow`.
    - Submitting "Deny" includes the same fields plus `decision=deny`.
    - Form `method` is POST and `action` is `/oauth/authorize/consent`.
  - If the public-metadata endpoint path is chosen: server test for `GET /api/oauth-clients/:client_id/public` returns `{ name, description, allowed_scopes }` and 404 for unknown / disabled clients.
- **Verification command**: `npm run test:client && npm run test:server`
