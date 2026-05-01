---
id: "002"
title: "signInHandler writes provider_payload and LoginEvent"
status: todo
use-cases: [SUC-017-001]
depends-on: ["001"]
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# signInHandler writes provider_payload and LoginEvent

## Description

After every successful sign-in (new or returning), `signInHandler` must:

1. Write the raw provider profile to `Login.provider_payload` and bump `provider_payload_updated_at` to `new Date()`.
2. Append a `LoginEvent` row with `login_id`, `payload` (raw profile), `ip`, `user_agent`.

**Modify `server/src/services/auth/sign-in.handler.ts`:**

- Extend `OAuthProfile` (or add a new type) so the raw provider profile is available. The current shape only has the extracted fields. Add a new field `rawProfile?: unknown` (or `providerPayload: unknown`) carrying the unparsed provider object. Populate it from each OAuth callback.
- Add an optional `requestContext?: { ip?: string; userAgent?: string }` argument to `signInHandler`. Pass it through.
- After the `Login` upsert (both step 1 — existing Login — and step 3c — new Login), update `Login.provider_payload` + `provider_payload_updated_at` and create a `LoginEvent`. Use `prisma.loginEvent.create({ data: { login_id, payload, ip, user_agent } })`.

**Modify `server/src/routes/auth.ts` callbacks (Google, GitHub, Pike13):**

- Pass `rawProfile: profile` (the full passport profile) into the call to `signInHandler`.
- Pass `requestContext: { ip: req.ip, userAgent: req.headers['user-agent'] }`.

**Modify `server/src/services/auth/passport.config.ts`** (Google + GitHub verify callbacks): same — pass through to `signInHandler`.

For Pike13 (manual flow in `auth.ts`): pass the `profile` object returned by `pike13FetchProfile`, plus `requestContext`.

## Acceptance Criteria

- [ ] After a successful sign-in (any provider), the user's `Login.provider_payload` is non-null and equals the raw provider profile.
- [ ] `Login.provider_payload_updated_at` reflects the most recent sign-in time.
- [ ] One `LoginEvent` row exists per sign-in event with `login_id`, `payload`, optional `ip`, optional `user_agent`.
- [ ] Sign-in still proceeds when `req.ip` or `user-agent` are missing — both are optional.
- [ ] `signInHandler` signature change is backwards-compatible (new params are optional); all existing callers compile.
- [ ] All sign-in tests still pass; new tests cover the payload + LoginEvent writes for Google, GitHub, and Pike13.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - In `tests/server/services/auth/sign-in.handler.test.ts`, add a describe block that asserts `provider_payload`, `provider_payload_updated_at`, and `LoginEvent` row creation for new Google, GitHub, and Pike13 sign-ins.
  - Returning sign-in: `provider_payload_updated_at` advances; a second `LoginEvent` row is appended.
- **Verification command**: `npm run test:server`
