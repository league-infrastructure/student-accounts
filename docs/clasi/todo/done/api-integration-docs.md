---
status: pending
---

# Create Remote API Integration Documentation

Write a guide in `docs/api-integrations.md` covering how to connect the
application to three external services: GitHub, Google, and Pike 13.

## Documentation Style: Link to Upstream, Don't Paraphrase

For each service, **link directly to the provider's own setup pages**
rather than writing step-by-step screenshots-and-clicks instructions.
Provider UIs change frequently — our docs go stale, theirs don't.

The guide should say things like:

> 1. Go to [GitHub Developer Settings → OAuth Apps](https://github.com/settings/developers)
>    and create a new OAuth App.
> 2. Set the callback URL to `http://localhost:5173/api/auth/github/callback`
>    (dev) or `https://<app>.jtlapp.net/api/auth/github/callback` (prod).
> 3. Copy the Client ID and Client Secret into `secrets/dev.env`.

NOT:

> 1. Click "Settings" in the top-right menu, then "Developer settings"
>    in the left sidebar, then "OAuth Apps", then "New OAuth App"...

## Required Sections Per Service

### GitHub

- **Registration:** Link to https://github.com/settings/developers
- **Docs:** Link to https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
- **What to copy:** Client ID, Client Secret
- **Callback URL:** `/api/auth/github/callback`
- **Scopes used by this app:** `read:user`, `user:email`
- **How to store:** `GITHUB_CLIENT_ID` and `GITHUB_CLIENT_SECRET` in
  `secrets/dev.env` / `secrets/prod.env`

### Google

- **Registration:** Link to https://console.cloud.google.com/apis/credentials
- **Docs:** Link to https://developers.google.com/identity/protocols/oauth2/web-server
- **What to copy:** Client ID, Client Secret
- **Callback URL:** `/api/auth/google/callback`
- **Scopes used by this app:** `profile`, `email`
- **Consent screen:** Note that Google requires configuring an OAuth
  consent screen — link to their docs for that
- **How to store:** `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`

### Pike 13

- **Registration:** Link to https://developer.pike13.com/docs/get_started
- **Auth docs:** Link to https://developer.pike13.com/docs/authentication
- **API reference:** Link to https://developer.pike13.com/docs/core-api-v2
- **What to copy:** Client ID, Client Secret (or access token, depending
  on their flow)
- **How to store:** `PIKE13_CLIENT_ID` and `PIKE13_CLIENT_SECRET`

### Common Section

- How secrets flow from `secrets/*.env` → `.env` → environment variables
  → `docker/entrypoint.sh` → application code (brief, link to
  `docs/secrets.md` for full details)
- How to verify credentials are working: hit the backend health/status
  endpoints after configuring
