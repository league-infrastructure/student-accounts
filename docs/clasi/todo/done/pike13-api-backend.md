---
status: pending
---

# Implement Pike 13 API Backend Routes

Add server-side routes that call the Pike 13 Core API (v2) to fetch
business data. Unlike GitHub and Google, this is a server-to-server
API call, not a user-facing OAuth login.

## Scope

- Create `server/src/routes/pike13.ts` with:
  - `GET /api/pike13/events` — proxies to Pike 13
    `GET /api/v2/desk/event_occurrences` and returns this week's events
  - `GET /api/pike13/people` — proxies to Pike 13
    `GET /api/v2/desk/people` (first page)
- Read `PIKE13_CLIENT_ID` and `PIKE13_CLIENT_SECRET` from environment
  variables
- Authenticate using Pike 13's OAuth2 client credentials or bearer token
  flow (confirm exact mechanism from their docs)
- Handle errors gracefully — if Pike 13 credentials are not configured,
  return a clear error message rather than crashing
- Register routes in `server/src/index.ts`

## Credential Setup References

When a user asks "how do I get Pike 13 API credentials?", point them to
these upstream URLs (do not paraphrase their portal UI — it changes):

- **Getting started:** https://developer.pike13.com/docs/get_started
- **Authentication (OAuth2):** https://developer.pike13.com/docs/authentication
- **Core API v2 reference:** https://developer.pike13.com/docs/core-api-v2
- **Event occurrences endpoint:** https://developer.pike13.com/docs/event-occurrences
- **People endpoint:** https://developer.pike13.com/docs/people

The code comments and error messages should also include these URLs
so developers can self-serve without reading separate docs.
