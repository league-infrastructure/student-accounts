---
id: '015'
title: Passphrase Self-Onboarding
status: done
branch: sprint/015-passphrase-self-onboarding
use-cases:
- SUC-001
- SUC-002
- SUC-003
- SUC-004
- SUC-005
- SUC-006
- SUC-007
- SUC-008
todos:
- plan-passphrase-self-onboarding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 015: Passphrase Self-Onboarding

## Goals

Enable instructor-driven classroom intake: an instructor drops a passphrase in Slack, students paste it into the signup page and choose a username, and they land on `/account` with a fully provisioned (or group-enrolled) account — no admin approval queue, no OAuth required.

Simultaneously, make the login form real: the existing username + password form currently posts to a dev-only test endpoint; this sprint wires it to a production-quality `POST /api/auth/login` backed by `crypto.scrypt` hashing.

## Problem

Today every student must sign in with Google or GitHub and then wait for admin approval. This is incompatible with the classroom intake flow: an instructor at the start of a session needs students online within minutes, not hours. There is also no mechanism for a "group" (lower-privilege, no workspace) to onboard its own members.

## Solution

A short-lived passphrase stored on a Group or Cohort acts as a class-wide admission ticket. At signup the passphrase is hashed onto the student's user record as their permanent credential. The student then signs in with `username + passphrase` via the production login endpoint. Cohort signups trigger workspace provisioning (fail-soft); group signups add the student to the group without a workspace.

Security posture is explicitly "classroom-grade": the passphrase is stored in plaintext on the parent row (for display to the instructor), is time-limited to one hour, and the hashed student password is `crypto.scrypt` — adequate for an internal classroom tool, not for internet-exposed credentials.

## Success Criteria

- Admin can generate, rotate, and revoke a passphrase on any cohort or group from the detail page.
- A student can sign up via a valid, non-expired passphrase and land on `/account` fully provisioned.
- A student can sign back in with `username + passphrase` after the class window closes.
- Expired and revoked passphrases return a clear error at signup.
- Username collisions are caught and reported clearly.
- `npx tsc --noEmit` passes in both client and server (server retains its 25 pre-existing errors).
- All new test suites are green; the existing baseline is unchanged.

## Scope

### In Scope

- Prisma schema additions: five passphrase fields on `Group` and `Cohort`; `username` and `password_hash` on `User`.
- Utility modules: `passphrase-words.ts` (curated kid-safe word list ≥ 400 words), `passphrase.ts` (generator + shape validator), `password.ts` (scrypt hash/verify).
- `PassphraseService` with create, revoke, getActive, and findBySignupValue operations; full audit trail.
- Admin routes: `POST/GET/DELETE /admin/cohorts/:id/passphrase` and same for groups.
- Public route `POST /api/auth/passphrase-signup` with cohort + group scopes, fail-soft workspace provisioning, and optional LLM proxy grant.
- Production `POST /api/auth/login` (username + scrypt password), replacing the dev-only test-login behind the client form.
- `PassphraseModal` client component with live-TTL card on `CohortDetailPanel` and `GroupDetailPanel`.
- `Login.tsx` changes: real login endpoint, passphrase-signup disclosure panel.
- Full unit and integration test coverage per the TODO test plan.
- Manual verification sweep as the final ticket (stakeholder sign-off gate).

### Out of Scope

- Passphrase-per-session or per-student uniqueness (one passphrase per scope at a time; rotation overwrites).
- Configurable TTL — hard-coded to 1 hour for v1.
- Email-based student signup.
- Removing or modifying the existing `/api/auth/test-login` endpoint (kept for tests).
- Any changes to the existing OAuth flows.

## Test Strategy

- **Unit tests**: `passphrase-words.ts` word list properties, `passphrase.ts` generation shape, `password.ts` hash/verify round-trip.
- **Service tests**: `PassphraseService` — create, rotate, revoke, expiry, collision detection.
- **Integration tests**: all six admin passphrase routes; full signup flow for cohort and group scopes (happy path, expired, collision, partial-success); login happy path and negative cases.
- **Client tests**: `PassphraseModal` — regenerate, LLM checkbox, submit URL; `Login.tsx` — endpoint targets, passphrase input visibility, disclosure toggle.
- **TypeScript**: `npx tsc --noEmit` in client and server before marking green.
- **Manual sweep**: see Verification section of `plan-passphrase-self-onboarding.md` (Ticket 009).

## Architecture Notes

See `architecture-update.md` for the full picture. Key constraints:

- Passphrase plaintext stored on the parent row — instructor needs to display it; security model is classroom-grade.
- Student `password_hash` uses Node's built-in `crypto.scrypt` — no new npm dependency.
- Login provider entry uses `provider='passphrase'` and `provider_user_id='<scope>:<id>:<username>'` to preserve the existing `(provider, provider_user_id)` uniqueness invariant.
- Fail-soft execution for workspace provisioning and LLM proxy grant happens outside the main transaction so a downstream failure does not roll back account creation.
- SSE notifications use the existing `adminBus.notify()` mechanism for the `cohorts`, `groups`, and `users` topics — no new bus infrastructure.

## GitHub Issues

(none)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

| # | Title | Depends On | Group |
|---|-------|------------|-------|
| 001 | Prisma schema migration | — | 1 |
| 002 | Server utilities: passphrase-words, passphrase, password | 001 | 2 |
| 003 | PassphraseService + ServiceRegistry wiring | 002 | 3 |
| 004 | Admin passphrase routes + integration tests | 003 | 4 |
| 005 | Public passphrase-signup endpoint + tests | 003 | 4 |
| 006 | Public login endpoint + tests + client wiring | 002 | 4 |
| 007 | PassphraseModal + detail page cards + tests | 004, 005, 006 | 5 |
| 008 | Login.tsx: signup disclosure + real login form | 006 | 5 |
| 009 | Manual smoke pass (stakeholder verification) | 007, 008 | 6 |

**Groups**: Tickets in the same group can execute in parallel.
Groups execute sequentially (1 before 2, etc.).
