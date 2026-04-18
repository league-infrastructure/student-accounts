---
status: done
sprint: 018
tickets:
- 018-011
- 018-012
- 018-013
- 018-014
- 018-015
---

# Plan — Social login & account linking for the template demo

## Context

The template's login page is currently **demo-only** — username/password form with `user`/`pass` and `admin`/`admin` hardcoded. Sprint 018 (ticket 004) stripped all OAuth Passport strategies (GitHub, Google, Pike 13) during the LEAGUEhub domain cleanup.

The stakeholder wants social login back, but implemented generically and **gated by configuration**: if a provider's client ID env var is set, the corresponding button appears. If not, the button is hidden. This keeps the template usable out-of-the-box with zero OAuth configuration while making it easy to turn providers on.

The stakeholder also wants **post-signup account linking**: a user who signed up one way (demo form, or one OAuth provider) can later add other providers from their Account page, binding additional OAuth identities to the same user record. This is already half-supported by the schema — the `UserProvider` model exists and was preserved through Sprint 018's strip — but the runtime code to use it doesn't exist.

## Target behavior

### Login page

The form (user/pass) stays. Below it, a "Or sign in with" divider, then a row of buttons rendered conditionally:

- **GitHub** button — shown only if `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` are set
- **Google** button — shown only if `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` are set
- **Pike 13** button — shown only if `PIKE13_CLIENT_ID` and `PIKE13_CLIENT_SECRET` are set

Visibility is determined by calling `GET /api/integrations/status` on mount (that endpoint already exists and reports configured-ness per provider).

Clicking a button redirects to `/api/auth/<provider>` which initiates the OAuth flow. On callback, the user is found-or-created, session established, and they land on `/`.

### Account page — provider linking

The Account page gets a new section: **Sign-in methods**. It shows:

- The user's primary provider (already stored as `User.provider`) — labeled as primary
- Any additional providers already linked (from `UserProvider` rows) — each with an "Unlink" button
- For each provider that is **configured but not yet linked** to this user, an "Add &lt;Provider&gt;" button

Clicking "Add &lt;Provider&gt;" initiates the same OAuth flow but with a flag (session cookie or query param) indicating "link mode, not login mode". On callback, the backend detects the flag and binds the OAuth identity to the current user (via a new `UserProvider` row) instead of creating a new user.

The Account page queries `GET /api/integrations/status` to know which providers are globally configured, and `GET /api/auth/me` (extended) to know which ones are already linked.

## Decisions (confirmed with stakeholder)

1. **Demo form** — always visible on `/login`, regardless of which providers are configured. Social buttons appear below it.
2. **Identity collision policy** — **auto-link by email**. If an OAuth login returns an email that matches an existing `User.email`, the OAuth identity is linked to that user (a `UserProvider` row is created) and they're logged in as that user. No new user is created. No UX prompt. (Implication: providers should be trusted to return verified emails. For GitHub and Google this is fine; Pike 13's email handling should be confirmed during implementation.)
3. **Primary lookup key** — `(provider, providerId)` first. If no match, fall back to `email`. This lets a user who signs up via the demo form and later does GitHub OAuth have their GitHub identity auto-bound to the demo account (per decision 2).
4. **Unlink guardrail** — a provider can only be unlinked if the user has **at least one other login method remaining** (another `UserProvider` row, or a local demo credential — though demo accounts aren't really "owned" by anyone, so for demo users this effectively means "another linked OAuth provider"). The primary `User.provider`/`providerId` is unlinkable under the same rule (it gets cleared to `null`; the user logs in via another provider from that point forward).
5. **Pike 13 included** — one TODO covers GitHub, Google, and Pike 13. The hand-rolled Pike 13 flow from sprint 011 is reintroduced alongside the two Passport strategies.

## Scope of the TODO (for a future sprint to pick up)

**Backend work:**

- Re-add Passport strategies for GitHub and Google (previously in `server/src/routes/auth.ts`, removed in ticket 004)
- Re-add Pike 13 OAuth flow (previously in `server/src/routes/pike13.ts`, deleted in ticket 001) — hand-rolled, not a Passport strategy
- New routes `GET /api/auth/<provider>` (initiate) and `GET /api/auth/<provider>/callback` (handle)
- New "link mode" flag on the authorize endpoint — e.g. `GET /api/auth/<provider>?link=1`. Callback handler reads it and either:
  - **Login mode**: look up by `(provider, providerId)`; if no match, look up by email and auto-link (per decision 2); if still no match, create a new user + `UserProvider` row; establish session
  - **Link mode**: requires an already-authenticated session; creates a `UserProvider` row binding `(provider, providerId)` to `req.user.id`; error if that identity is already bound to a different user
- Extend `GET /api/auth/me` to include `linkedProviders: string[]` (list of provider names from `UserProvider` rows, plus the primary if set)
- Route `POST /api/auth/unlink/:provider` — deletes the `UserProvider` row for the current user; enforces guardrail (decision 4: must leave at least one remaining login method); clears `User.provider`/`providerId` if the primary was unlinked
- Passport `deserializeUser` stays user-only (as it is now); access tokens for API calls (like `github.ts`'s repo list) come from the session not `req.user`

**Frontend work:**

- `LoginPage` — fetch `/api/integrations/status` on mount, render conditional provider buttons below the demo form
- `Account.tsx` — new "Sign-in methods" section with linked providers list, unlink buttons, and "Add &lt;Provider&gt;" buttons for configured-but-unlinked providers
- Shared `useProviderStatus()` hook or equivalent that returns `{ github: boolean, google: boolean, pike13: boolean }` — used by both pages
- Button styling — simple, recognizable per-provider (GitHub dark, Google white-with-border, Pike 13 orange using their brand color `#f37121`)

**Schema:**

- No changes — `UserProvider` already exists with `@@unique([provider, providerId])` for lookup and `userId` for linkage. Enough as-is.

**Configuration / secrets:**

- Env vars already expected: `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `PIKE13_CLIENT_ID`, `PIKE13_CLIENT_SECRET` (plus any Pike 13 redirect URL / API base)
- Document in `.claude/rules/api-integrations.md` (already describes this setup) — update as needed to reflect the new flow

## Acceptance criteria (draft — for the future ticket set)

1. With no OAuth env vars set, `/login` shows only the demo form — identical to today's behavior
2. With `GITHUB_CLIENT_ID`/`_SECRET` set, `/login` shows "Sign in with GitHub" below the demo form; clicking it completes OAuth and lands the user logged in on `/`. Same for Google and Pike 13 with their respective env vars
3. First-time OAuth login for a new identity whose email **does not** match any existing user creates a `User` row AND a `UserProvider` row for that provider
4. First-time OAuth login whose email **matches** an existing user auto-links: creates a `UserProvider` row on the existing user, no new user created, session established as that existing user (per decision 2)
5. Subsequent login via the same `(provider, providerId)` finds the same `User` (no duplicate accounts)
6. Account page lists the user's linked providers and shows an "Add &lt;Provider&gt;" button for any configured-but-unlinked provider
7. Clicking "Add &lt;Provider&gt;" while logged in creates a `UserProvider` row on callback — does NOT create a new user, does NOT change primary `User.provider`
8. Attempting to link an OAuth identity that's already bound to a different user returns a clear error and does not modify any data
9. Unlink button is disabled / rejected when the user has only one remaining login method (decision 4)
10. Tests cover: login flow for each provider, auto-link by email (decision 2), link flow from Account page, unlink with and without the guardrail tripping, cross-user collision (test 8)

## Non-goals

- Email/password registration (demo login stays hardcoded)
- Password reset / forgot flows
- MFA / 2FA
- Organization-level OAuth gating (e.g. restrict to specific GitHub orgs) — can be a follow-up

## Verification (when the future sprint runs this)

1. Set `GITHUB_CLIENT_ID` + `GITHUB_CLIENT_SECRET` in `.env`; restart dev servers
2. Visit `/login` — confirm GitHub button appears
3. Complete GitHub OAuth — confirm landing on `/` and `/api/auth/me` shows `provider: "github"`
4. Log out, log in as `user`/`pass`
5. Visit Account page — confirm "Add GitHub" button
6. Click it, complete OAuth — confirm return to Account page with GitHub now listed as a linked provider AND confirm `/api/auth/me` shows both demo-local email and github linkage
7. Run server test suite — all pass
