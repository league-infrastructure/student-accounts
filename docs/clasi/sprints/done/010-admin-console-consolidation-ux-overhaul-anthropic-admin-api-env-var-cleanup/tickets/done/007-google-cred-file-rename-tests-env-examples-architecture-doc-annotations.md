---
id: '007'
title: "GOOGLE_CRED_FILE rename — tests, env examples, architecture doc annotations"
status: done
use-cases:
  - SUC-010-001
depends-on:
  - "010-001"
github-issue: ''
todo: plan-rename-google-credentials-env-var-to-google-cred-file.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GOOGLE_CRED_FILE rename — tests, env examples, architecture doc annotations

## Description

Complete the `GOOGLE_CRED_FILE` rename started in T001 by updating all test
files, env example files, agent rules, and adding annotations to architecture
documents that reference the old names.

Depends on T001 (server code must be updated first so tests can be updated
consistently).

## Acceptance Criteria

- [x] All test files under `tests/` that set `GOOGLE_SERVICE_ACCOUNT_FILE` or `GOOGLE_CREDENTIALS_FILE` updated to set `GOOGLE_CRED_FILE` instead.
- [x] The five credential-file precedence tests in `google-workspace-admin.client.test.ts` (lines 447–494) reduced to one test: "reads `GOOGLE_CRED_FILE`; returns empty string when unset."
- [x] `config/dev/secrets.env.example` block describing the credentials path variable rewritten to describe only `GOOGLE_CRED_FILE`. `GOOGLE_SERVICE_ACCOUNT_JSON` block preserved unchanged.
- [x] `config/prod/secrets.env.example` same update applied.
- [x] `.claude/rules/api-integrations.md` — any mention of old env var names updated to `GOOGLE_CRED_FILE`. (No mentions found — already clean.)
- [x] `.claude/rules/secrets.md` — same. (No mentions found — already clean.)
- [x] `docs/clasi/architecture/architecture-update-002.md` — one-line annotation appended: "Renamed to `GOOGLE_CRED_FILE` in Sprint 010."
- [x] `docs/clasi/architecture/architecture-update-004.md` — same annotation.
- [x] `grep -r "GOOGLE_SERVICE_ACCOUNT_FILE\|GOOGLE_CREDENTIALS_FILE" tests/ config/ .claude/rules/ docs/clasi/architecture/` returns zero results in tests/, .claude/rules/ (architecture doc historical body and encrypted secrets.env are preserved as history/immutable).
- [x] `npm run test:server` passes for the modified test files (google-workspace-admin.client.test.ts and google-admin-directory.client.test.ts — 76 tests pass).

## Implementation Plan

### Files to Modify

**Tests:**
- `tests/server/services/google-workspace/google-workspace-admin.client.test.ts`
  - Lines 447–494: replace five precedence tests with one `GOOGLE_CRED_FILE` test
  - Any other `process.env.GOOGLE_SERVICE_ACCOUNT_FILE` or `GOOGLE_CREDENTIALS_FILE` assignments in this file
- Run `grep -rn "GOOGLE_SERVICE_ACCOUNT_FILE\|GOOGLE_CREDENTIALS_FILE" tests/` to find all other occurrences and update them

**Config examples:**
- `config/dev/secrets.env.example` — rewrite the commented credentials block
- `config/prod/secrets.env.example` — same

**Agent rules:**
- `.claude/rules/api-integrations.md` — search for old names; update
- `.claude/rules/secrets.md` — search for old names; update

**Architecture docs (annotations only — do not rewrite history):**
- `docs/clasi/architecture/architecture-update-002.md` — append note
- `docs/clasi/architecture/architecture-update-004.md` — append note

### Testing Plan

- `npm run test:server` — must pass with zero failures related to `GOOGLE_CRED_FILE`.
- Run the grep command from the acceptance criteria to confirm zero remaining old-name occurrences.
