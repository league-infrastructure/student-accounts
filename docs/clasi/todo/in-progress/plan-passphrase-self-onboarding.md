---
status: in-progress
sprint: '015'
tickets:
- 015-001
- 015-002
- 015-003
- 015-004
- 015-005
- 015-006
- 015-007
- 015-008
- 015-009
---

# Passphrase Self-Onboarding for Groups and Cohorts

## Context

Today a student joins the platform by signing in with Google or GitHub and then waiting for an admin to approve them. The instructor-driven workflow we actually want for classroom intake is: *"paste this into the signup page and type a username"*.

The passphrase has two roles:
1. **Class admission ticket** — class-wide credential the instructor drops in Slack at the start of a session. Time-limited (1 hour); after that no new signups can use it.
2. **The student's permanent password** — at signup the typed passphrase is hashed onto the new user's account. The student logs in next time with their chosen `username` + that same passphrase. Multiple students who signed up during the 1-hour window all end up with the same password text but different usernames, which is fine — security here is "good enough for a classroom", not "credentials we'd protect from the internet".

The passphrase lives on a **group** or a **cohort**. Cohort passphrases also provision a League workspace account. Group passphrases don't create a workspace — they're the lower-privilege option for one-off workshops. Either scope can optionally grant an LLM proxy token at signup.

Affected surfaces: admin detail pages for groups and cohorts, the public login screen (now a real username + password form, not the dev-only test-login), a public signup API, a new login API, and a new auth flow that carefully sets approval/activation state so these users don't land in the pending-accounts widget.

---

## Decisions

- **Data model — passphrase**: inline fields on `Group` and `Cohort`. Only one active passphrase per scope; rotation overwrites. Plaintext storage; this is "classroom-grade" not internet-grade security.
- **Data model — student credential**: add `username` (`String? @unique`) and `password_hash` (`String?`) to `User`. Hash with `crypto.scrypt` (no extra npm dep) — `salt + ":" + key` stored as a single string.
- **Passphrase shape**: three lowercase words joined by hyphens — e.g. `purple-cactus-river`. Admin can edit the generated suggestion before saving.
- **Word list**: a hand-curated list of short, common, typo-resistant English words checked into the server, **scrubbed for anything sexual, profane, drug-related, violent, or insulting** since the audience is kids. Target ≥ 400 words; 400³ ≈ 64M combinations (~26 bits), plenty for a 1-hour window. Start from the EFF short list, prune, and review.
- **TTL**: 1 hour from creation, hard-coded for v1. Expiry is enforced lazily at signup time. The hash that becomes the student's password is **not** affected by passphrase expiry — the student can keep logging in with the same string forever.
- **Collision**: when generating, regenerate if the plaintext matches any other active, non-expired passphrase in the DB.
- **Group scope ≠ cohort scope at signup**:
  - Cohort → workspace provisioning (fail-soft), user's `cohort_id` set to the scope id, workspace email becomes `primary_email`.
  - Group → no workspace, user added as a member of the group. Synthesize a placeholder `primary_email` as `<username-slug>.g<groupId>@signup.local` for the unique-email constraint. The student logs in by `username`, not by this synthetic email, so its ugliness never surfaces.
- **LLM proxy checkbox**: a boolean `grant_llm_proxy` on the passphrase; at signup, if true, mint a 30-day / 1M-token proxy token. The student sees the token plaintext on `/account` (current behavior — kept).
- **User state at signup**: `role = 'student'`, `approval_status = 'approved'`, `is_active = true`, `onboarding_completed = true` (they already chose a name). Because approval status is `'approved'`, these users don't show up in the pending-accounts widget.
- **Login row**: provider `'passphrase'`, `provider_user_id = '<scope>:<id>:<username>'` — keeps the `(provider, provider_user_id)` uniqueness intact and gives the audit trail something to attribute the signup to.
- **Session**: use the same `req.session.userId = ...` pattern the OAuth callbacks use (e.g. [server/src/routes/auth.ts:331](../../../server/src/routes/auth.ts#L331)).
- **Login is a real endpoint now, not test-login**: today the username/password form on `/login` posts to `/api/auth/test-login` (dev-only). Replace it with a real `POST /api/auth/login` that authenticates `username + password` against `password_hash` and sets the session. Existing `test-login` stays for tests.

---

## Server

### Prisma schema ([server/prisma/schema.prisma](../../../server/prisma/schema.prisma))

Add to `Group` and `Cohort` (five fields each):

```prisma
// On Group and Cohort
signup_passphrase                  String?
signup_passphrase_grant_llm_proxy  Boolean   @default(false)
signup_passphrase_expires_at       DateTime?
signup_passphrase_created_at       DateTime?
signup_passphrase_created_by       Int?
```

Add to `User` (two fields):

```prisma
username       String?  @unique   // local-login handle, only set for passphrase signups
password_hash  String?            // scrypt(salt + ":" + key); only set for passphrase signups
```

New Prisma migration via `prisma/sqlite-push.sh` (dev-DB convention per CLAUDE.md).

### New utility files

- **[server/src/utils/passphrase-words.ts](../../../server/src/utils/passphrase-words.ts)** — exports a `readonly string[]` of ≥ 400 short common words. Start from the EFF short list, then prune by hand: anything sexual / profane / drug-related / violent / insulting / scatological is removed. Audience is kids; the list goes through one explicit review pass before commit.
- **[server/src/utils/passphrase.ts](../../../server/src/utils/passphrase.ts)** — pure helpers:
  ```ts
  generatePassphrase(words: 3 | 4 = 3): string  // crypto.randomInt-backed pick + hyphen join
  validatePassphraseShape(input: string): boolean
  ```
- **[server/src/utils/password.ts](../../../server/src/utils/password.ts)** — minimal `hashPassword(plain) → 'salt:keyHex'` and `verifyPassword(plain, stored) → boolean` using `crypto.scrypt` with `crypto.timingSafeEqual` for the comparison.

### New service [server/src/services/passphrase.service.ts](../../../server/src/services/passphrase.service.ts)

Thin service with a polymorphic internal signature so the groups and cohorts routes can share it:

```ts
type Scope = { kind: 'group' | 'cohort'; id: number };

class PassphraseService {
  async create(scope, opts: { plaintext?: string; grantLlmProxy: boolean }, actorId): Promise<Record>
  async revoke(scope, actorId): Promise<void>
  async getActive(scope): Promise<Record | null>
  // Signup side:
  async findBySignupValue(plaintext: string): Promise<
    | { scope: 'group'; id: number; grantLlmProxy: boolean }
    | { scope: 'cohort'; id: number; grantLlmProxy: boolean }
    | null
  >
}
```

All mutations write a `create_signup_passphrase` / `revoke_signup_passphrase` audit event inside the Prisma transaction (mirrors existing `GroupService.create` pattern).

### Admin routes

Extend existing files rather than create a new router:

**[server/src/routes/admin/cohorts.ts](../../../server/src/routes/admin/cohorts.ts)** — add three handlers:
- `POST   /admin/cohorts/:id/passphrase` — body `{ plaintext?: string; grantLlmProxy: boolean }`; returns `{ plaintext, expiresAt, grantLlmProxy }`
- `DELETE /admin/cohorts/:id/passphrase` — revoke
- `GET    /admin/cohorts/:id/passphrase` — 200 with the active payload or 404

**[server/src/routes/admin/groups.ts](../../../server/src/routes/admin/groups.ts)** — same three for groups.

Both fire `adminBus.notify('cohorts')` / `adminBus.notify('groups')` on success.

### Public signup + login routes

New file **[server/src/routes/auth/passphrase-signup.ts](../../../server/src/routes/auth/passphrase-signup.ts)**, mounted before any requireAuth middleware:

```
POST /api/auth/passphrase-signup
  body: { username: string, passphrase: string }
  200:  { id, username, displayName, primaryEmail, cohort, workspace: {...}, llmProxy: {...} }
  401:  { error: 'Invalid or expired passphrase' }
  400:  { error: 'Username must be 2–32 characters' } | other validation
  409:  { error: 'That username is already taken' }
```

Handler in **[server/src/services/auth/passphrase-signup.handler.ts](../../../server/src/services/auth/passphrase-signup.handler.ts)**:
1. Validate username shape: 2–32 chars, `^[a-z0-9._-]+$` after lowercasing. Reject empty / pure-symbols.
2. Look up passphrase via `PassphraseService.findBySignupValue`; 401 if missing/expired.
3. Pre-check username uniqueness in `User.username`; 409 if taken.
4. Slug for derived email via `displayNameToSlug` ([server/src/utils/email-slug.ts](../../../server/src/utils/email-slug.ts)).
5. Derive `primary_email`:
   - Cohort → `<slug>@<cohort-domain>` (same as workspace provisioning at [workspace-provisioning.service.ts:163–177](../../../server/src/services/workspace-provisioning.service.ts#L163-L177))
   - Group → `<slug>.g<groupId>@signup.local`
6. If email collides, retry with `<slug>-2`, `<slug>-3`, up to 5 attempts; else 409.
7. `prisma.$transaction`:
   - Create `User` via `userService.createWithAudit({ username, password_hash: hashPassword(passphrase), display_name: username, primary_email, role:'student', approval_status:'approved', is_active:true, onboarding_completed:true, cohort_id: scope==='cohort' ? scope.id : null })`
   - Create `Login` with `provider='passphrase'`, `provider_user_id = '<scope>:<scopeId>:<username>'`.
8. Set `req.session.userId` (direct assignment, same as OAuth callbacks at [server/src/routes/auth.ts:331](../../../server/src/routes/auth.ts#L331)).
9. **Fail-soft**, outside the commit:
   - Cohort → `workspaceProvisioning.provision(userId, actorId=userId, tx)` in a fresh transaction.
   - `grant_llm_proxy` true → `llmProxyTokens.grant(userId, {expiresAt:+30d, tokenLimit:1e6}, userId, {scope:'single'})`.
   - Group → `groupService.addMember(groupId, userId, actorId=userId)`.
10. `adminBus.notify('users')` + scope topic.
11. Return the partial-success payload.

New file **[server/src/routes/auth/login.ts](../../../server/src/routes/auth/login.ts)** (real login, replaces the dev-only shape behind the existing form):

```
POST /api/auth/login
  body: { username: string, password: string }
  200:  { id, displayName, primaryEmail, role }
  401:  { error: 'Invalid username or password' }   // generic for both cases
```

Handler:
1. Look up `User` by `username` (lowercase). If missing or `password_hash` is null, return 401 (generic).
2. `verifyPassword(password, user.password_hash)`. If false, 401 (generic).
3. Set `req.session.userId`. Return profile.

Existing `/api/auth/test-login` is kept untouched for tests.

### ServiceRegistry

[server/src/services/service.registry.ts](../../../server/src/services/service.registry.ts) — register `passphrases: PassphraseService`.

---

## Client

### New modal [client/src/components/PassphraseModal.tsx](../../../client/src/components/PassphraseModal.tsx)

Modeled on [client/src/components/LlmProxyGrantModal.tsx](../../../client/src/components/LlmProxyGrantModal.tsx). Props: `{ isOpen, scope: { kind, id, name }, onClose, onCreated(result) }`. Contents:
- Editable text input pre-filled with a freshly generated passphrase (admin can type a different one).
- A "Regenerate" button to roll a new suggestion.
- Checkbox: "Also grant an LLM proxy token when students sign up".
- "Cancel" / "Create" buttons.
- On Create: POSTs to the right scope endpoint, passes the response back via `onCreated`.

### Passphrase card inside each detail page

Rendered above the member table in both:
- [client/src/pages/admin/CohortDetailPanel.tsx](../../../client/src/pages/admin/CohortDetailPanel.tsx) — directly under the "Sync to group" box.
- [client/src/pages/admin/GroupDetailPanel.tsx](../../../client/src/pages/admin/GroupDetailPanel.tsx) — directly under the header/toolbar.

Behavior:
- No active passphrase → shows "Create passphrase" button.
- Active passphrase → shows the plaintext (monospace, selectable), "expires in Xm", Copy button, Regenerate button, Revoke button, and a ✓ indicator if `grantLlmProxy` is true.
- Live TTL countdown via a simple `setInterval(1000)`. When `expiresAt` passes, the card flips back to "Create passphrase" without a page refresh.
- The card's data comes from `GET /admin/<scope>s/:id/passphrase` using React Query key `['admin', 'cohorts' | 'groups', id, 'passphrase']`. Invalidated by the SSE `cohorts` / `groups` topic (already wired in [useAdminEventStream.ts](../../../client/src/hooks/useAdminEventStream.ts)).

### Login page — real login form + signup panel

[client/src/pages/Login.tsx](../../../client/src/pages/Login.tsx) gets two changes:

1. **The existing username/password form** stops POSTing to `/api/auth/test-login` and instead POSTs to `/api/auth/login`. The "Password" input becomes `type="text"` so the student can verify the passphrase as they type. The label changes to "Username" / "Passphrase".

2. **A new disclosure** below the OAuth buttons titled *"New student? Sign up with a class passphrase"* expands to a sibling form with the same two fields but POSTing to `/api/auth/passphrase-signup`. Both forms share the same input components and validation.

On 200: `window.location.assign('/account')` so the new session cookie takes effect on the next request.

On 401/409: inline error.

---

## Tests

### Server

- **[tests/server/utils/passphrase.test.ts](../../../tests/server/utils/passphrase.test.ts)** — `generatePassphrase` shape, every word is in the curated list, no duplicate words within a single phrase.
- **[tests/server/utils/password.test.ts](../../../tests/server/utils/password.test.ts)** — `hashPassword` / `verifyPassword` round-trip; wrong-password rejection; empty/null guards.
- **[tests/server/services/passphrase.service.test.ts](../../../tests/server/services/passphrase.service.test.ts)** — create, rotate, revoke, getActive, findBySignupValue, expiry semantics, collision retry.
- **[tests/server/routes/admin-passphrase.test.ts](../../../tests/server/routes/admin-passphrase.test.ts)** — six admin routes (cohort + group × create/revoke/get).
- **[tests/server/routes/auth-passphrase-signup.test.ts](../../../tests/server/routes/auth-passphrase-signup.test.ts)** — full signup flow for each scope:
  - Happy path cohort → workspace provisioned, LLM proxy granted when opted in.
  - Happy path group → user added to group, no workspace.
  - Expired / revoked passphrase → 401.
  - Username collision → 409.
  - Partial-success (workspace provision fails) returns 200 with `workspace.provisioned=false`.
  - After signup, the same `username + passphrase` works against `POST /api/auth/login`.
- **[tests/server/routes/auth-login.test.ts](../../../tests/server/routes/auth-login.test.ts)** — login happy path, wrong password 401, missing user 401, never leaks which.

### Client

- **[tests/client/PassphraseModal.test.tsx](../../../tests/client/PassphraseModal.test.tsx)** — regenerate, edit, LLM-proxy checkbox, submit calls the right URL.
- **[tests/client/Login.test.tsx](../../../tests/client/Login.test.tsx)** *(extend or rewrite existing)* — login submit posts to `/api/auth/login`, signup disclosure submits to `/api/auth/passphrase-signup`, passphrase input is visible (`type="text"`).

---

## Critical files touched

### New
- `client/src/components/PassphraseModal.tsx`
- `server/src/routes/auth/login.ts`
- `server/src/routes/auth/passphrase-signup.ts`
- `server/src/services/auth/passphrase-signup.handler.ts`
- `server/src/services/passphrase.service.ts`
- `server/src/utils/passphrase-words.ts`
- `server/src/utils/passphrase.ts`
- `server/src/utils/password.ts`
- `tests/server/utils/passphrase.test.ts`
- `tests/server/utils/password.test.ts`
- `tests/server/services/passphrase.service.test.ts`
- `tests/server/routes/admin-passphrase.test.ts`
- `tests/server/routes/auth-login.test.ts`
- `tests/server/routes/auth-passphrase-signup.test.ts`
- `tests/client/PassphraseModal.test.tsx`

### Modified
- `client/src/pages/Login.tsx`
- `client/src/pages/admin/CohortDetailPanel.tsx`
- `client/src/pages/admin/GroupDetailPanel.tsx`
- `server/prisma/schema.prisma` *(+ migration)*
- `server/src/routes/admin/cohorts.ts`
- `server/src/routes/admin/groups.ts`
- `server/src/services/service.registry.ts`
- `server/src/routes/auth.ts` *(mount the new sub-routers)*
- `tests/client/Login.test.tsx` *(extend with the new flows)*

---

## Verification

- `npx tsc --noEmit` in `client/` and `server/` — no new errors (server retains its 25 pre-existing).
- `npm run test:server` — all new suites green plus existing baseline.
- `npm run test:client` — existing baseline unchanged.
- Manual browser sweep:
  1. In `/groups/:id` and `/cohorts/:id`: Create passphrase button opens modal, Create saves and card shows countdown. Regenerate rotates. Revoke clears. TTL countdown hits zero → card flips back to empty state.
  2. In `/login` (signed out), expand the passphrase signup panel, use a valid cohort passphrase → lands on `/account` with workspace account + (optional) LLM proxy visible.
  3. Same flow with a group passphrase → lands on `/account`, is a member of the group, no workspace.
  4. Sign out, then sign back in via the main login form using the same `username + passphrase` → succeeds.
  5. Sign in with the wrong passphrase → inline "Invalid username or password" (generic, no enumeration).
  6. Try to sign up with a passphrase that's expired or revoked → inline "Invalid or expired passphrase".
  7. Username collision at signup → inline "That username is already taken".
</content>
</invoke>