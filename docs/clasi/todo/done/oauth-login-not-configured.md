---
status: done
sprint: '010'
tickets:
- '007'
---

# GitHub and Google OAuth login returns "not configured" errors

## Description

The login page has GitHub and Google OAuth buttons, but clicking them returns
JSON errors:

```
{"error":"GitHub OAuth not configured","docs":"https://github.com/settings/developers"}
{"error":"Google OAuth not configured","docs":"https://console.cloud.google.com/apis/credentials"}
```

The `.env` file contains the required secrets (`GITHUB_CLIENT_ID`,
`GITHUB_CLIENT_SECRET`, `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and the
callback URLs are configured in `config/dev/public.env`. The OAuth Passport
strategies likely have a guard that checks for these env vars at registration
time, but the vars aren't being picked up — possibly because the server's
`dotenv.config()` runs before the strategies are registered, or the strategy
registration is gated on a check that fails.

Needs investigation into `server/src/routes/auth.ts` and the Passport strategy
setup to determine why the credentials aren't recognized despite being in `.env`.
