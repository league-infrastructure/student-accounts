---
id: "006"
title: "Manual smoke pass stakeholder verification sweep"
status: todo
use-cases: [SUC-017-001, SUC-017-002, SUC-017-003]
depends-on: ["001", "002", "003", "004", "005"]
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Manual smoke pass stakeholder verification sweep

## Description

Stakeholder owns this ticket. After tickets 001–005, walk through the
running app and verify provenance + directory enrichment work end-to-end
against real Google.

## Smoke checklist

- [ ] `npm run dev` starts cleanly.
- [ ] Sign in with a `@jointheleague.org` Google account that's in the `/Staff` OU.
- [ ] Open the dev DB (`prisma studio` or sqlite shell) and inspect the user's `Login` row:
  - `provider_payload` is non-null and contains the Google profile.
  - `provider_payload_updated_at` is recent.
  - `directory_metadata` is `{ ou_path: '/Staff', groups: [...] }` with at least one group.
- [ ] At least one `LoginEvent` row exists for this Login with `ip` and `user_agent` set.
- [ ] Sign out, sign in via GitHub. Verify `provider_payload` populated, `directory_metadata` null, new `LoginEvent` row.
- [ ] Sign out, sign in via Pike13 (if Pike13 OAuth app is configured). Same check.
- [ ] Temporarily simulate a Google admin failure (e.g., set GOOGLE_ADMIN_DELEGATED_USER_EMAIL to an invalid value) and re-sign in as staff. Confirm sign-in still completes (302 → /account, session established) — fail-soft works.
- [ ] No 5xx in server logs during any of the above.

## Acceptance Criteria

- [ ] All checklist items pass.

## Testing

- **Existing tests to run**: none (manual).
- **New tests to write**: none.
- **Verification command**: visual / DB inspection.
