---
id: '003'
title: Add stub pages and 404 route for dead-end links
status: done
use-cases: []
depends-on:
- '001'
---

# Add stub pages and 404 route for dead-end links

## Description

Home page cards link to `/profile`, `/plan`, `/questionnaire` and the user
dropdown links to `/account` — none of which have routes. Navigating to
any unknown URL shows a blank page.

Fix by:
1. Create a reusable ComingSoon stub component.
2. Add routes for `/profile`, `/plan`, `/questionnaire`, `/account` using the
   stub component with appropriate titles.
3. Add a catch-all `*` route with a 404 "Page Not Found" component inside
   AppLayout.

## Acceptance Criteria

- [ ] `/profile` shows "Coming Soon" stub with Profile title
- [ ] `/plan` shows "Coming Soon" stub with Academic Plan title
- [ ] `/questionnaire` shows "Coming Soon" stub with Questionnaire title
- [ ] `/account` shows "Coming Soon" stub with Account title
- [ ] Any other undefined route shows 404 page with link to Home
- [ ] All stub/404 pages are wrapped in AppLayout (sidebar visible)

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write**: 404 page renders, stub pages render
- **Verification command**: `npm run test:client`
