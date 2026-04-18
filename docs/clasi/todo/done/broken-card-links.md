---
title: Home page cards link to non-existent routes
priority: high
status: done
sprint: '010'
tickets:
- '003'
---

## Problem

The Home page has four quick-start cards. Three of them link to routes that
don't exist in the React Router config:

- **Your Profile** → `/profile` — blank page, no route
- **Academic Plan** → `/plan` — blank page, no route
- **Interest Questionnaire** → `/questionnaire` — blank page, no route

Only **Start Chatting** → `/chat` has a matching route.

Additionally, the user dropdown "Account" button navigates to `/account`,
which also has no route.

## Expected Behavior

Either:
- Add placeholder/stub pages for these routes with "Coming Soon" messaging
- Remove or disable the cards that link to unimplemented features
- Link to something that exists (e.g., the About page with a section about
  upcoming features)

## Files

- `client/src/pages/Home.tsx` — card links at lines 39, 49, 59
- `client/src/App.tsx` — route definitions (missing these routes)
- `client/src/components/AppLayout.tsx` — Account button at line 367
