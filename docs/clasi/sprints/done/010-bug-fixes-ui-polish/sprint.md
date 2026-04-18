---
id: '010'
title: Bug Fixes & UI Polish
status: done
branch: sprint/010-bug-fixes-ui-polish
use-cases: []
---

# Sprint 010: Bug Fixes & UI Polish

## Goals

Fix critical bugs and UI issues discovered during manual app testing so that
the application is usable end-to-end on a fresh install.

## Problem

Manual testing revealed 8 issues ranging from broken auth to dead-end links.
The app appears to be logged in but API calls fail, the Chat page has a
double-sidebar layout, several Home page cards link to non-existent routes,
and basic UX elements (page title, 404 page, search bar) are broken or
missing.

## Solution

1. Fix the auth flow: add a login page, remove the fake placeholder user,
   auto-login in dev mode via the test-login endpoint.
2. Fix the Chat layout: remove the duplicate sidebar so Chat integrates
   with AppLayout.
3. Add stub pages for unimplemented features (Profile, Plan, Questionnaire,
   Account) so cards don't lead to blank pages.
4. Add a 404 catch-all route.
5. Fix the page title.
6. Wire up or remove the search bar.
7. Add a database seed script with a default "general" channel.

## Success Criteria

- App is usable end-to-end on a fresh `npm run dev` with no prior setup
- User can log in (dev auto-login or OAuth)
- Chat page loads channels and messages without layout issues
- All Home page cards lead to real pages
- Unknown routes show a 404 page
- Browser tab shows correct app name

## Scope

### In Scope

- Login page with OAuth buttons and dev auto-login
- Remove placeholder user from AuthContext
- Fix Chat page layout (single sidebar)
- Stub pages for Profile, Plan, Questionnaire, Account
- 404 catch-all route
- Fix page title in index.html
- Wire search bar to backend or remove it
- Database seed script for default channel

### Out of Scope

- Full implementation of Profile, Plan, Questionnaire features
- New features or functionality beyond bug fixes
- Production deployment changes

## Test Strategy

- Server tests: verify test-login creates session, verify seed script
- Client tests: update existing tests for layout changes, add login page test
- Manual verification via browser after all fixes

## Architecture Notes

- No architectural changes. All fixes are within existing patterns.
- Login page follows the same inline-styles pattern as other pages.
- Stub pages are minimal "Coming Soon" placeholders.

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete
- [x] Architecture review passed (bug fix sprint, no arch changes)
- [x] Stakeholder has approved the sprint plan

## Tickets

1. Fix auth: login page, remove placeholder, dev auto-login
2. Fix Chat page double-sidebar layout
3. Add stub pages and 404 route for dead-end links
4. Fix page title, search bar, and add seed data
