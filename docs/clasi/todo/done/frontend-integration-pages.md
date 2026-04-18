---
status: pending
---

# Build Single-File Example Application

Create a **single-file** React component that demonstrates all three
integrations (GitHub OAuth, Google OAuth, Pike 13 API). This file is
disposable — when a developer starts building their real app, they
delete this one file and the example is gone. The backend routes and
services it calls remain untouched.

## Design Constraint: Easy to Rip Out

The entire example UI must live in **one file** (e.g.,
`client/src/pages/ExampleIntegrations.tsx`). It should:

- Be the only non-infrastructure frontend file that references the
  integration API routes
- Have a single route entry in the router that can be deleted in one line
- Not require any shared components, context providers, or state stores
  that the rest of the app depends on

When a developer deletes this file and its route, the app should still
build and run with zero errors.

## Graceful Degradation: Missing API Keys

The example page must **not** require that any API keys are configured.
On mount, it calls `GET /api/integrations/status` to discover which
integrations are available. For each service:

- **Configured:** Show the normal action button ("Connect GitHub", etc.)
- **Not configured:** Show a disabled/muted card that says something like
  "GitHub OAuth — not configured. See docs/api-integrations.md to set up
  credentials." No error, no crash, no hidden section — the user sees
  exactly what's missing and where to fix it.

This means a developer who clones the template, runs `npm run dev`, and
opens the browser sees the counter working and three "not configured"
cards. They can set up one service at a time and see it light up.

## What the Example Shows

A single page with sections:

1. **Counter** — the existing increment/decrement demo (proves the basic
   stack works)
2. **GitHub** — if configured: "Connect GitHub" button → OAuth login →
   displays username, avatar, email, and a list of repos.
   If not configured: muted card with setup instructions link.
3. **Google** — if configured: "Connect Google" button → OAuth login →
   displays name, email, avatar.
   If not configured: muted card with setup instructions link.
4. **Pike 13** — if configured: "Show This Week's Events" button →
   fetches and displays a table of events (no login required).
   If not configured: muted card with setup instructions link.

All API calls use simple `fetch()` — no service wrappers, no shared
abstractions. The file is self-contained.

## What Stays After Deletion

These backend pieces are permanent template infrastructure and must NOT
depend on the example file:

- `server/src/routes/auth.ts` (GitHub + Google OAuth)
- `server/src/routes/github.ts` (GitHub API proxy)
- `server/src/routes/pike13.ts` (Pike 13 API proxy)
- Session and Passport configuration in `server/src/index.ts`
- Secret entries in `secrets/*.env.example`
