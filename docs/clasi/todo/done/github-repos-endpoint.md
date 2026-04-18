---
status: pending
---

# Add GitHub Repos API Endpoint

After GitHub OAuth login, the app should be able to fetch the
authenticated user's repositories to demonstrate a real API call
with the stored access token.

## Scope

- Store the GitHub access token in the session during OAuth callback
  (in addition to the profile)
- Create `server/src/routes/github.ts` with:
  - `GET /api/github/repos` — calls the GitHub API
    `GET https://api.github.com/user/repos` using the session's access
    token, returns the list of repos (name, description, URL, stars,
    language)
- Return 401 if the user is not logged in via GitHub
- Register route in `server/src/index.ts`
