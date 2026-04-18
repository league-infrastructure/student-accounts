---
id: '007'
title: Add Pike 13 API proxy routes
status: done
use-cases:
- SUC-004
depends-on:
- '002'
---

# Add Pike 13 API proxy routes

## Description

Create routes that proxy requests to the Pike 13 Core API v2 using a
pre-obtained access token. No user-facing login — server-to-server calls.

## Changes

1. **`server/src/routes/pike13.ts`** (new):
   - `GET /api/pike13/events` — calls Pike 13
     `GET /api/v2/desk/event_occurrences` with date range for current week.
     Returns formatted event list.
   - `GET /api/pike13/people` — calls Pike 13
     `GET /api/v2/desk/people` (first page).
   - Uses `Authorization: Bearer <PIKE13_ACCESS_TOKEN>` from env
   - Returns 501 with docs URL if `PIKE13_ACCESS_TOKEN` not set
   - API base: `https://pike13.com/api/v2/desk/` (or subdomain from env)

2. **`server/src/index.ts`** — register pike13 router

## Credential Setup References

Include these URLs in 501 error responses and code comments:
- Getting started: https://developer.pike13.com/docs/get_started
- Authentication: https://developer.pike13.com/docs/authentication
- Event occurrences: https://developer.pike13.com/docs/event-occurrences

## Acceptance Criteria

- [ ] `GET /api/pike13/events` returns this week's events when configured
- [ ] `GET /api/pike13/people` returns people list when configured
- [ ] Both return 501 with docs URL when `PIKE13_ACCESS_TOKEN` not set
- [ ] Server starts cleanly without Pike 13 env vars
- [ ] Error responses include upstream doc URLs

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: `tests/server/pike13.test.ts`
  - `GET /api/pike13/events` when not configured → 501 with `{ error, docs }` shape
  - `GET /api/pike13/people` when not configured → 501 with `{ error, docs }` shape
  - 501 response bodies contain Pike 13 docs URLs
  - (Actual API calls require real Pike 13 token — manual test only)
- **Verification command**: `npm run test:server`
