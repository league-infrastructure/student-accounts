---
status: pending
---

# Implement Google OAuth Backend

Add Google OAuth login flow to the Express backend using Passport.js.

## Scope

- Install `passport-google-oauth20`
- Add Google strategy to `server/src/routes/auth.ts`:
  - `GET /api/auth/google` — initiates OAuth redirect
  - `GET /api/auth/google/callback` — handles the callback, stores user in
    session
- Configure Passport Google strategy reading `GOOGLE_CLIENT_ID` and
  `GOOGLE_CLIENT_SECRET` from environment variables
- Callback URL: `/api/auth/google/callback`
- Requested scopes: `profile`, `email`
- On successful login, store the Google user profile (display name, email,
  avatar) in the session
- The `/api/auth/me` and `/api/auth/logout` endpoints from the GitHub TODO
  are shared across all providers

## Credential Setup References

When a user asks "how do I get a Google client ID?", point them to
these upstream URLs (do not paraphrase the Google console UI — it changes):

- **Create OAuth credentials:** https://console.cloud.google.com/apis/credentials
- **OAuth 2.0 for web apps:** https://developers.google.com/identity/protocols/oauth2/web-server
- **Configure consent screen:** https://developers.google.com/identity/protocols/oauth2/web-server#creatingclient
  (Google requires a consent screen before issuing credentials)
- **Scopes reference:** https://developers.google.com/identity/protocols/oauth2/scopes

The code comments and error messages should also include these URLs
so developers can self-serve without reading separate docs.
