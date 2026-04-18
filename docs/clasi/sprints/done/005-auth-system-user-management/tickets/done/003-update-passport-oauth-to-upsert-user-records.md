---
id: '003'
title: Update Passport OAuth to upsert User records
status: todo
use-cases:
- SUC-001
depends-on:
- '002'
---

# Update Passport OAuth to upsert User records

## Description

Modify the existing Passport OAuth callbacks (GitHub and Google) to
create or update User records in the database on every login. Update
session serialization to store only the user's database ID, and
deserialization to load the full User record from the database. Update
`GET /api/auth/me` to return the database User record.

### Changes

1. **`server/src/routes/auth.ts`** — OAuth callbacks:
   - In the GitHub OAuth verify callback, after receiving the profile,
     call `UserService.upsertFromOAuth('github', profile.id, { email, displayName, avatarUrl })`
   - Do the same for the Google OAuth verify callback with
     `provider: 'google'`
   - Pass the resulting User record (not the raw OAuth profile) to
     Passport's `done()` callback

2. **`server/src/routes/auth.ts`** — Serialization:
   - `serializeUser`: Store only `user.id` in the session
   - `deserializeUser`: Load the full User record from the database
     using `UserService.getById(id)`. If the user is not found (deleted
     or invalid session), call `done(null, false)` to clear the session

3. **`server/src/routes/auth.ts`** — `/api/auth/me`:
   - Update `GET /api/auth/me` to return the full User record from
     `req.user` (which is now a database User, not an OAuth profile)
   - Return 401 if `req.user` is not set

4. **Handle stale sessions**: If `deserializeUser` finds no user for
   the stored ID, the session should be invalidated gracefully (no
   crash, user sees logged-out state).

## Acceptance Criteria

- [ ] GitHub OAuth login creates a new User record in the database on
  first login
- [ ] GitHub OAuth login updates the existing User record on subsequent
  logins (same provider + providerId)
- [ ] Google OAuth login creates/updates User records the same way
- [ ] New users default to `USER` role
- [ ] User record contains email, displayName, avatarUrl, provider,
  and providerId from the OAuth profile
- [ ] Session stores only the user's database ID (not the full profile)
- [ ] `deserializeUser` loads the full User record from the database
- [ ] Stale sessions (user deleted from DB) are handled gracefully
- [ ] `GET /api/auth/me` returns the full User record for authenticated
  users
- [ ] `GET /api/auth/me` returns 401 for unauthenticated requests
- [ ] Server compiles with `tsc --noEmit`

## Testing

- **Existing tests to run**: `npm run test:server` to verify no regressions
- **Manual verification**: Log in via GitHub/Google OAuth, then check
  `GET /api/auth/me` returns a User record with database fields
- **Verification command**: `cd server && npx tsc --noEmit`
