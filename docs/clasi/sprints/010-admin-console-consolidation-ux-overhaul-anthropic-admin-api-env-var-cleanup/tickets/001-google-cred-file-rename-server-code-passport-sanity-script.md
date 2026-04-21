---
id: '001'
title: "GOOGLE_CRED_FILE rename — server code, passport, sanity script"
status: todo
use-cases:
  - SUC-010-001
depends-on: []
github-issue: ''
todo: plan-rename-google-credentials-env-var-to-google-cred-file.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GOOGLE_CRED_FILE rename — server code, passport, sanity script

## Description

The stakeholder renamed the Google service-account credentials path in
`config/dev/public.env` to `GOOGLE_CRED_FILE`, but server code still reads
`GOOGLE_CREDENTIALS_FILE` (preferred) and `GOOGLE_SERVICE_ACCOUNT_FILE`
(legacy). This causes Workspace sign-in and cohort sync to silently fail.

Update server code, passport config, and the sanity script to read only
`GOOGLE_CRED_FILE`. Drop the old names entirely — no fallback.

## Acceptance Criteria

- [ ] `resolveCredentialsFileEnvVar()` in `google-workspace-admin.client.ts` returns `process.env.GOOGLE_CRED_FILE ?? ''` with no fallback to old names.
- [ ] All log strings in `google-workspace-admin.client.ts` that named `GOOGLE_SERVICE_ACCOUNT_FILE` or `GOOGLE_CREDENTIALS_FILE` now name `GOOGLE_CRED_FILE`.
- [ ] Fail-secure warning in `passport.config.ts` references `GOOGLE_CRED_FILE` only.
- [ ] All occurrences of `GOOGLE_SERVICE_ACCOUNT_FILE` in `scripts/sanity-check-service-account.mjs` replaced with `GOOGLE_CRED_FILE`.
- [ ] `grep -r "GOOGLE_SERVICE_ACCOUNT_FILE\|GOOGLE_CREDENTIALS_FILE" server/src/ scripts/` returns zero results.
- [ ] `npm run test:server` passes (tests using old names addressed in T007).

## Implementation Plan

### Files to Modify

**`server/src/services/google-workspace/google-workspace-admin.client.ts`**
- `resolveCredentialsFileEnvVar()`: remove multi-var precedence logic; return `process.env.GOOGLE_CRED_FILE ?? ''`
- Update log source tag and message strings on lines ~378–393, 405, 413, 420–421, 440–441, 469

**`server/src/services/auth/passport.config.ts`**
- Lines 45–54: update warning text to reference `GOOGLE_CRED_FILE`

**`scripts/sanity-check-service-account.mjs`**
- Replace all `GOOGLE_SERVICE_ACCOUNT_FILE` occurrences with `GOOGLE_CRED_FILE`

**`server/src/services/service.registry.ts`**
- Read-only: confirm `resolveCredentialsFileEnvVar()` is the only call site; no direct env reads. No code change.

### Testing Plan

- Run `npm run test:server` — baseline must pass (tests that set old env vars are failing already and will be fixed in T007, so they may fail here; confirm pre-existing vs. new breakage).
- Manual: `node scripts/sanity-check-service-account.mjs` with `GOOGLE_CRED_FILE` set should print OK.

### Notes

`GOOGLE_SERVICE_ACCOUNT_JSON` (inline JSON) is a different env var and is not renamed.
