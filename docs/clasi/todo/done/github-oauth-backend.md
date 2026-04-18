---
status: pending
---

# Implement GitHub OAuth Backend

Add GitHub OAuth login flow to the Express backend using Passport.js.

## Scope

- Install `passport`, `passport-github2`, and `express-session` (if not
  already present)
- Create `server/src/routes/auth.ts` with:
  - `GET /api/auth/github` — initiates OAuth redirect
  - `GET /api/auth/github/callback` — handles the callback, stores user in
    session
  - `GET /api/auth/me` — returns the currently logged-in user (or 401)
  - `POST /api/auth/logout` — destroys session
- Configure Passport GitHub strategy reading `GITHUB_CLIENT_ID` and
  `GITHUB_CLIENT_SECRET` from environment variables
- Callback URL: `/api/auth/github/callback`
- Requested scopes: `read:user`, `user:email`
- On successful login, store the GitHub user profile (username, avatar URL,
  email) in the session
- Register the auth routes in `server/src/index.ts`

## Credential Setup References

When a user asks "how do I get a GitHub client ID?", point them to
these upstream URLs (do not paraphrase the GitHub UI — it changes):

- **Create an OAuth App:** https://github.com/settings/developers
- **GitHub OAuth docs:** https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/creating-an-oauth-app
- **Scopes reference:** https://docs.github.com/en/apps/oauth-apps/building-oauth-apps/scopes-for-oauth-apps

The code comments and error messages should also include these URLs
so developers can self-serve without reading separate docs.
