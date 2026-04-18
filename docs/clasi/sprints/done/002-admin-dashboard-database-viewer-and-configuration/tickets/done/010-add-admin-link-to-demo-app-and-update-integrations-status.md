---
id: '010'
title: Add admin link to demo app and update integrations status
status: in-progress
use-cases:
- SUC-011
depends-on:
- '002'
- '003'
---

# Add admin link to demo app and update integrations status

## Description

Final integration ticket. Add an "Admin" link to the demo app's
ExampleIntegrations page, and update the integrations status endpoint to
report on the new services (GitHub token, Claude, OpenAI).

## Tasks

1. Update `client/src/pages/ExampleIntegrations.tsx`:
   - Add a visible link/button to `/admin` (e.g., in the header or as a
     card at the top)
   - Use React Router's `<Link>` component

2. Update `server/src/routes/integrations.ts`:
   - Add status checks for new services using the config service:
     ```typescript
     githubToken: {
       configured: !!getConfig('GITHUB_TOKEN'),
     },
     anthropic: {
       configured: !!getConfig('ANTHROPIC_API_KEY'),
     },
     openai: {
       configured: !!getConfig('OPENAI_API_KEY'),
     },
     ```

3. Verify that deleting `ExampleIntegrations.tsx` (the demo page) does not
   break any admin routes or functionality. Document this in a brief test.

## Acceptance Criteria

- [ ] Demo page has a visible link to `/admin`
- [ ] Link uses React Router (no full page reload)
- [ ] `/api/integrations/status` reports status for github, google, pike13,
      githubToken, anthropic, and openai
- [ ] Status endpoint uses config service (checks both env vars and DB)
- [ ] Deleting ExampleIntegrations.tsx does not break admin pages
- [ ] Deleting ExampleIntegrations.tsx does not cause build errors (only
      requires removing the route from App.tsx)

## Testing

- **Existing tests to run**: `npm run test:server`, `npm run test:client`
- **New tests to write**:
  - Update `tests/server/integrations.test.ts` (if exists) to check new
    service statuses
- **Verification command**: `npm run test:server`
