---
status: in-progress
sprint: 028
tickets:
- 028-017
---

# Make /signup discoverable: Login link + visible Passphrase field

## Context

Sprint 028 ticket 014 added a registration page at
[client/src/pages/Signup.tsx](client/src/pages/Signup.tsx) mounted
at `/signup`. The page has four fields (Username, Password, Full
name, Email) and reads the class passphrase from `?passphrase=…`
in the URL only. The Login page redirects an unauthenticated
visitor with `?passphrase=` to `/signup?passphrase=…`.

The page is functionally invisible to anyone who doesn't already
have an invitation URL: the Login page has no link to Signup, and
visiting `/signup` directly renders a form whose submission
silently fails because the passphrase isn't an input. Stakeholder
wants Signup discoverable from Login, with the passphrase as a
typed field on the form (pre-filled when arriving via the
invitation URL, otherwise empty for the student to type in).

## Implementation plan

### A. Login page — add "Sign up" link

[client/src/pages/Login.tsx](client/src/pages/Login.tsx) — under
the Sign in form (around line 187, after the submit button or
after the OAuth buttons), add a small footer line mirroring the
"Already have an account? Sign in" pattern that Signup already
uses:

```tsx
<p className="mt-4 text-center text-sm text-slate-500">
  Need an account?{' '}
  <Link to="/signup" className="text-indigo-600 hover:underline">
    Sign up
  </Link>
</p>
```

Place it just above the OAuth divider so it sits with the
username/passphrase form, not the OAuth alternative.

### B. Signup page — visible Passphrase field

[client/src/pages/Signup.tsx](client/src/pages/Signup.tsx):

1. Replace the URL-only passphrase read with controlled state:
   ```tsx
   const [passphrase, setPassphrase] = useState(
     searchParams.get('passphrase') ?? ''
   );
   ```
2. Add a Passphrase input as the **first** field in the form
   (before Username), styled like the others, `required` and
   marked with helper text like "The phrase your instructor gave
   you". When the value came from the URL, the field is still
   editable but pre-filled.
3. The existing POST body already sends `passphrase`; just point
   it at the controlled state value.

### C. No server changes

`/api/auth/passphrase-signup` already validates the passphrase and
returns a clear error ("Invalid or expired passphrase") on failure.
That error already surfaces in the existing inline `<p
role="alert">` block, so a typed-in wrong passphrase is handled
without new server work.

## Critical files

- [client/src/pages/Login.tsx](client/src/pages/Login.tsx) — add
  the Sign up link.
- [client/src/pages/Signup.tsx](client/src/pages/Signup.tsx) —
  promote `passphrase` from URL-only to a controlled form field.

## Out of scope

- Changing the signup-without-passphrase server gate (still
  required; signup form just collects it from the user instead of
  the URL).
- Email verification / additional anti-abuse on signup.
- A "passphrase forgot" recovery flow.
- Auto-detecting & redirecting `?passphrase=` URLs from Signup as
  well (already handled by Login's invitation-URL handler — direct
  visits to `/signup?passphrase=…` work because the field is
  pre-filled).

## Verification

- Visit `/login` in an incognito window — see the "Need an
  account? Sign up" link beneath the Sign in form. Click it →
  land on `/signup` with an empty Passphrase field.
- Type the four fields plus a known-valid class passphrase →
  Submit → land on `/account` already authenticated.
- Type a wrong passphrase → Submit → see the existing inline
  error.
- Visit an invitation URL `/login?passphrase=<value>` while
  signed-out → redirected to `/signup?passphrase=<value>`. The
  Passphrase field is visible and pre-filled with the URL value.
- Run [tests/client/pages/Signup.test.tsx](tests/client/pages/Signup.test.tsx) —
  add cases: form renders with empty passphrase by default; URL
  passphrase pre-fills; user can edit the value; submit posts
  whatever the input currently holds. Run
  [tests/client/pages/Login.test.tsx](tests/client/pages/Login.test.tsx) —
  add a case that the Sign-up link is rendered with `href="/signup"`.
