---
status: in-progress
sprint: 028
tickets:
- 028-010
---

# Invitation-URL flow + account-setup screen + add-password button + force-full-name gate

## Context

Sprint 028 added a clickable invitation URL of the form
`{origin}/login?passphrase={plaintext}` to PassphraseCard, but the
Login page currently ignores the `?passphrase=` query param —
clicking it drops the student on the manual login form with nothing
pre-filled. The current passphrase signup also collects only
`username + passphrase`; there's no full name or self-supplied
email captured at signup, and the resulting `Login(provider=
'passphrase')` row has no provider_email/provider_username.

Stakeholder wants the invitation URL to Just Work:
- If the visitor already has an Express session, take them straight
  to `/account`.
- Otherwise, run a setup form that collects username + new password
  + full name + email, creates a real identity, and lands them on
  `/account` already authenticated.

Two related pieces follow:
- Every user (including OAuth-only) gets an "Add username/password"
  button in LoginsSection, symmetric with Add Google / Add GitHub.
- Any user landing on `/account` without `onboarding_completed`
  must complete a "full name (+ email)" form before the rest of the
  page is usable.

## Stakeholder decisions (locked from Q&A)

- **Auth check** — existing Express session cookie. If
  `req.session.userId` is set, invitation URL → `/account`.
  Otherwise → account-setup form. No new token concept.
- **Setup form email** — becomes `User.primary_email`. League
  workspace email (when admin toggles `allows_league_account`
  later) is still derived from `<username>@<workspace_domain>`;
  that's separate.
- **Force-name gate** — trigger on `User.onboarding_completed ===
  false`. The existing flag is already on the schema and already
  set to `true` by passphrase signup; the OAuth signup paths get
  audited so they leave it `false` when no real first+last is
  available, then the new `/account` modal collects it.
- **Returning visitor (no session) revisits invitation URL** —
  show the setup form with a "sign in instead" link beneath
  pointing to `/login`. No auto-merge.

## Implementation plan

### A. Server — widen `/api/auth/passphrase-signup`

`server/src/services/auth/passphrase-signup.handler.ts`

New body shape:
```ts
{
  passphrase: string,
  username: string,
  password: string,        // NEW — student-supplied; replaces "use the passphrase as the password"
  displayName: string,     // NEW — full name
  email: string            // NEW — student's email; becomes User.primary_email
}
```

Validate all four. Hash the new `password` (not the passphrase) into
`User.password_hash`. Set `User.display_name = displayName.trim()`,
`User.primary_email = email.trim().toLowerCase()`,
`User.onboarding_completed = true`. Create
`Login(provider='passphrase', provider_user_id='<scope>:<scopeId>:<username>',
provider_email=email, provider_username=username)` so the row shows
nicely in the Account LoginsSection table.

The legacy two-field body (passphrase + username only) is no longer
accepted — return 400 if `password`, `displayName`, or `email` is
missing. The existing Login.tsx fallback POST gets removed in step C.

### B. Server — `/api/account/credentials` extension

`server/src/routes/account.ts` PATCH `/credentials`. When the user
has neither `username` nor `password_hash` today (no `currentPassword`
to verify), accept the patch as a "first-time setup" path. On success,
ALSO create a `Login(provider='passphrase', provider_user_id=
'self:<userId>:<username>', provider_email=user.primary_email,
provider_username=username)` row if one doesn't already exist for
this user. (For users who already had credentials, no new Login row
is created — the existing one stays.)

### C. Client — new `/signup` page + invitation URL handler

New file `client/src/pages/Signup.tsx`. Route `/signup` mounted under
the public layout (no auth required). Reads `?passphrase=<value>`
from the URL. Renders a four-field form (username, password, full
name, email) plus a small "Already have an account? Sign in" link
to `/login`. POST to `/api/auth/passphrase-signup` with the new
five-field body; on success, navigate to `/account`.

`client/src/pages/Login.tsx` — invitation URL handling:
- On mount, if `?passphrase=<value>` is present, call
  `/api/auth/me`. If 200 (already authenticated) → `navigate('/account')`.
  If 401 → `navigate('/signup?passphrase=<value>')`.
- Drop the existing fallback that POSTed to `/api/auth/passphrase-signup`
  with just username + passphrase (it's been replaced by the
  Signup page).

### D. Client — Add username/password button in LoginsSection

`client/src/pages/Account.tsx` LoginsSection. Add a button to the Add
row alongside Add Google / Add GitHub / Add Pike 13. Hidden when
`profile.username !== null && profile.has_password === true` (user
already has both). Opens an inline modal (mirror the ConfirmDialog
pattern) collecting `username` + `newPassword`; on submit, calls
`PATCH /api/account/credentials` (extended in step B). On success
the LoginsSection refetches, the new `passphrase` Login row appears
in the table, and the UsernamePasswordSection (already shown when
credentials exist) becomes available for further edits.

### E. Client — force-full-name gate on Account page

`client/src/pages/Account.tsx`. When `data.profile.onboarding_completed
=== false`, render ONLY a "Complete your profile" form: full name
field + email field (pre-filled with current values if any). Submit
posts to existing `/api/account/complete-onboarding` (extended to
accept email if needed; today it accepts displayName only — extend
the route to also accept and persist email). The rest of the
Account page is hidden until completion.

The `onboarding_completed` field is already returned on
`/api/account` profile (verify by inspection). If not, add it.

### F. OAuth signup audit (corollary)

The four OAuth signup paths (Google, GitHub, Pike13, sign-in handler)
currently auto-set `onboarding_completed = true` regardless of
whether the provider supplied a real name. Audit each: if the
provider didn't return a `displayName` containing a space (heuristic
for "first last"), leave `onboarding_completed = false` so the new
gate (step E) collects it on first visit.

This is a behaviour change for existing users with sketchy display
names — they'll see the modal once. Acceptable tradeoff.

## Tickets (suggested)

1. Server: widen passphrase-signup body + create proper Login row.
2. Server: extend PATCH /credentials for first-time setup + Login
   row creation.
3. Server: extend POST /complete-onboarding to accept email.
4. Server: OAuth signup paths audit — leave `onboarding_completed
   = false` when no full name was provided.
5. Client: new `/signup` page.
6. Client: Login page invitation-URL session check + redirect to
   `/signup` (drop the legacy fallback POST).
7. Client: Add username/password button + modal in LoginsSection.
8. Client: force-full-name gate on Account.tsx.
9. Tests for each ticket + manual smoke.

## Critical files

- `client/src/pages/Login.tsx`
- `client/src/pages/Signup.tsx` (new)
- `client/src/pages/Account.tsx`
- `client/src/pages/account/UsernamePasswordSection.tsx`
- `client/src/App.tsx` (add `/signup` route)
- `server/src/services/auth/passphrase-signup.handler.ts`
- `server/src/routes/account.ts`
- `server/src/routes/auth.ts` and the OAuth signup handlers (for
  step F)
- `server/prisma/schema.prisma` (no changes; `onboarding_completed`
  + `Login.provider` are already present)

## Out of scope

- Schema migrations (none needed).
- Replacing the column-based `User.username`/`password_hash`
  storage with a Login-row-only model (kept for now —
  username/password auth still reads the column; the Login row is
  informational).
- Invitation URL → server-side passphrase token cookie (not used).
- Email verification on the entered email (deferred).

## Verification

- Manual: incognito window, visit `{origin}/login?passphrase=<value>`
  for a freshly-created group passphrase. See the redirect to
  `/signup?passphrase=<value>`. Fill in the four fields. Submit.
  Land on `/account`. Refresh the original invitation URL — go
  straight to `/account` (session present).
- Manual: as an OAuth-only user (Google/GitHub), click "Add
  username/password" in the Account LoginsSection, set creds, sign
  out, sign back in via `/login` with those creds.
- Manual: a user with `onboarding_completed = false` lands on
  `/account` → sees ONLY the "Complete your profile" form. Submit
  with a real full name → modal goes away, normal Account view
  shows. Refresh — flag is true; modal does not return.
- Manual: returning student visits the invitation URL from a fresh
  browser (no session). Sees setup form with "sign in instead" link.
  Click the link → `/login`. Sign in as themselves → `/account`.
- Tests:
  - `tests/server/services/auth/passphrase-signup.handler.test.ts`
    — new body shape, Login row created, password is the entered
    value (not the passphrase), email becomes primary_email.
  - `tests/server/routes/account-credentials.test.ts` — first-time
    setup path (no currentPassword required when neither column
    populated); Login row created.
  - `tests/server/routes/account-complete-onboarding.test.ts` —
    accepts email + displayName.
  - `tests/client/pages/Signup.test.tsx` (new) — form renders,
    posts the right body, navigates on success.
  - `tests/client/pages/Account.test.tsx` — Add-username/password
    button visibility + opens modal; force-full-name gate hides
    the rest of the page when `onboarding_completed === false`.
  - `tests/client/pages/Login.test.tsx` — `?passphrase=` redirects
    to `/signup` when not authenticated, to `/account` when
    authenticated.
