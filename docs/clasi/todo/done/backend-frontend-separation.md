---
status: pending
---

# Ensure Backend Integrations Are Independent of Example UI

Architectural constraint that applies across all integration TODOs:
the backend API routes for GitHub, Google, and Pike 13 are **permanent
template infrastructure**, while the frontend example page is
**disposable scaffolding**.

## Rules

1. **Backend routes are self-contained.** Each route file
   (`auth.ts`, `github.ts`, `pike13.ts`) registers itself, handles its
   own errors, and works regardless of what frontend exists.

2. **No frontend-specific backend code.** The backend must not contain
   routes, redirects, or logic that only make sense for the example page.
   OAuth callbacks should redirect to a generic path (e.g., `/` or a
   query-parameter-based redirect) that any future frontend can use.

3. **Session and Passport config lives in server setup.** Passport
   strategy registration, session middleware, serialization — all of this
   is configured in `server/src/index.ts` (or a dedicated middleware
   file), not in the route files.

4. **The example page is one file.** See the
   `frontend-integration-pages.md` TODO. Deleting that single file (and
   its route entry) removes the entire example with no side effects.

5. **Route registration is unconditional.** The auth and API proxy routes
   are always registered in `server/src/index.ts`. They don't depend on
   environment variables being set — if credentials are missing, the
   routes return a clear error (e.g., 501 "GitHub OAuth not configured")
   rather than not being registered at all.

6. **Configuration status endpoint.** Add `GET /api/integrations/status`
   that returns which integrations have credentials configured:
   ```json
   {
     "github": { "configured": true },
     "google": { "configured": false },
     "pike13": { "configured": false }
   }
   ```
   This checks whether the relevant environment variables are set (not
   empty), without exposing their values. The frontend calls this on
   load to decide what to show.

7. **The app must start cleanly with zero integrations configured.**
   No API keys set? No errors on startup, no crashes, no warnings in
   the server log beyond a one-time info line per unconfigured service.
   The backend works, the frontend works, the counter works — the
   integration features just aren't available yet.

## Verification

After all integration TODOs are done, verify this by:

- Deleting the example page file
- Removing its route from the router
- Running `npm run build` — should succeed with zero errors
- Hitting `/api/auth/me` — should return 401 (not 404)
- Hitting `/api/pike13/events` — should return data or a config error
  (not 404)
