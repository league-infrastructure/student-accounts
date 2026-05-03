---
status: done
sprint: '027'
---

# Student Account page: inline-edit username + email picker + Features section

Stakeholder direction captured 2026-05-03 after sprint 027 shipped
the per-user permission grid. The Student "My Account" page gets
three UX upgrades.

## A. Click-to-edit username (display name)

**What:** The username (display name shown at the top of the profile)
becomes click-to-edit inline. Click the value → it flips to a text
input → blur or Enter saves via the existing rename mutation
(`patchDisplayName` in `Account.tsx`).

**What "username" means here:** based on the rest of the request,
this is the visible profile name (`displayName`), not the login
passphrase username (which lives in `UsernamePasswordSection`).
**Confirm before implementing.**

**Existing infra:** `ProfileSection` already supports `onRename`;
just swap the affordance from whatever it is now to inline
click-to-edit.

## B. Click-to-pick notification email

**What:** The email field on the profile becomes a click-to-open
dropdown listing every email associated with the account (primary
email + each provider login's email + workspace external_id if
present). Selecting one persists it as the "notification email" —
the address the system uses when sending mail to this user.

**Server work:**
- New column on User: `notification_email String?` (nullable; default
  null means "use primary_email").
- PATCH endpoint to set it: probably `PATCH /api/account/profile`
  with `{ notification_email }` (or extend an existing endpoint).
  Validate that the chosen email is one the user actually owns
  (primary_email, a provider Login's provider_email, or a workspace
  ExternalAccount's external_id).
- `/api/account` returns `notificationEmail` plus an array of
  `availableEmails` so the client can render the dropdown.
- Anywhere the system actually sends mail to a user, prefer
  `notification_email ?? primary_email`. (Search for outbound mail
  call sites — there may be few or zero today; if zero, this just
  lays the groundwork.)

**Client work:**
- Profile email field becomes a `<select>` (or a click-to-open menu)
  bound to `notificationEmail`. Save on change.

## C. Features section between Profile and Logins

A new section listing the user's enabled features. Each row is
short:

- **OAuth Clients:** "You have N OAuth clients" (with link to
  `/oauth-clients`) when the user has any. If they have the
  permission but no clients yet: "Create an OAuth client" (link to
  the new-client page). If they have neither permission nor
  clients, the row is hidden entirely.
- **LLM Proxy:** "You have access." Shows the API key and URL
  inline (or maybe just a "view details" link to `/llm-proxy`).
  Clicking the row navigates to `/llm-proxy` for full details.
  Hidden when the user has no token.

**Server work:**
- `/api/account` already returns `llmProxyEnabled`. Add
  `oauthClientCount` (count of non-disabled OAuth clients owned by
  the user). The admin-side `/api/admin/users` already returns this
  per row (sprint 025/003); reuse the same Prisma `_count`
  approach.
- For the LLM proxy "API key" display: the client probably already
  has a hook for the token. The token plaintext is shown ONCE at
  grant time and not stored, so we can't redisplay it; instead
  display the masked token (e.g. `sk-llmp-xxx...xxx`) and the
  endpoint URL. The full plaintext lives only on the LLM Proxy
  page (which user can navigate to from this row).

**Client work:**
- New `FeaturesSection` component in `Account.tsx` rendered between
  Profile and Logins.
- Hide rows whose feature isn't enabled.

## Stakeholder clarifications still needed

1. **"Username" means displayName, not the passphrase login
   username — confirm.** Default assumption: displayName.
2. **Where does the LLM Proxy row's API key come from on the
   account page?** Options:
   - Show masked token only; full key available on `/llm-proxy`
     (Recommended — plaintext isn't persisted).
   - Show the full key (would require persisting it, which we
     deliberately do not do).
3. **Notification-email setter validation strictness:** should the
   set fail if the chosen email isn't currently in the user's
   email set, or just warn?

## Out of scope

- Redesigning ProfileSection beyond the inline-edit affordance.
- Adding email verification on the chosen notification email.
- Outbound-mail integration (we just lay the data; if outbound mail
  doesn't exist yet, plumbing the call sites is a separate ticket).
- Per-feature toggles on the Features section (admins control via
  the group grid; this section is read-only / informational from
  the student's POV).

## Suggested ticket shape

1. Schema: add User.notification_email; prisma db push.
2. Server: extend /api/account to return notificationEmail,
   availableEmails, oauthClientCount (verify llmProxyEnabled is
   already there), and the masked LLM proxy token.
3. Server: PATCH /api/account/profile (or extend) to accept
   notification_email; validate; audit.
4. Client: ProfileSection inline-edit for displayName.
5. Client: Email picker dropdown bound to notification_email.
6. Client: New FeaturesSection (OAuth Clients row + LLM Proxy row).
7. Manual smoke.
