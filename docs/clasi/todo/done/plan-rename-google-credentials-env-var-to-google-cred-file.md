---
status: done
sprint: '010'
tickets:
- 010-001
- 010-004
- 010-005
- 010-006
- 010-007
- 010-008
- 010-009
- 010-010
- 010-011
- 010-012
- 010-013
- 010-014
---

# Plan — Rename Google credentials env var to `GOOGLE_CRED_FILE`

## Context

The stakeholder has renamed the Google service-account credentials path in `.env` to `GOOGLE_CRED_FILE`. The code still reads only `GOOGLE_CREDENTIALS_FILE` (preferred) and `GOOGLE_SERVICE_ACCOUNT_FILE` (legacy), so the app no longer finds the credentials and every `@jointheleague.org` sign-in and Workspace sync fails.

`config/dev/public.env:19` already uses `GOOGLE_CRED_FILE=...`, so the intent was clearly to move to the shorter name — the code just wasn't updated.

Stakeholder decision: **replace** — only `GOOGLE_CRED_FILE` should be read. The old names are dropped from both code and docs. Any machine still using an old name will need its `.env` updated in the same commit.

## Scope (out of process — direct change, no sprint ceremony)

### Code

1. **`server/src/services/google-workspace/google-workspace-admin.client.ts`**
   - Replace `resolveCredentialsFileEnvVar()` to read only `GOOGLE_CRED_FILE`.
   - Update the error/warn log strings that name the old variables (`resolveServiceAccountJson`, `buildAuthClient`, and the `source` field in debug logs: lines 378–393, 405, 413, 420–421, 440–441, 469).
   - Rename the `GOOGLE_SERVICE_ACCOUNT_FILE` log source tag to `GOOGLE_CRED_FILE` for consistency.

2. **`server/src/services/auth/passport.config.ts:45–54`**
   - Update the fail-secure warning message text to reference `GOOGLE_CRED_FILE` instead of the two old names.

3. **`server/src/services/service.registry.ts:88–90`**
   - No code change (uses `resolveCredentialsFileEnvVar()`), but confirm behavior still correct after the rename.

4. **`scripts/sanity-check-service-account.mjs`**
   - Replace every `GOOGLE_SERVICE_ACCOUNT_FILE` reference (lines 6, 17, 66, 82, 85, 88) with `GOOGLE_CRED_FILE`.

### Tests

5. **`tests/server/services/google-workspace/google-workspace-admin.client.test.ts:447–494`**
   - The five precedence tests become one: "reads `GOOGLE_CRED_FILE`; returns empty string when unset." Drop the "legacy wins when new is empty" and "new wins when both set" cases — those scenarios no longer exist.
   - Update any other test in this file that sets `GOOGLE_SERVICE_ACCOUNT_FILE` or `GOOGLE_CREDENTIALS_FILE` to set `GOOGLE_CRED_FILE` instead.

6. Grep the full `tests/` tree for either old name and update.

### Config & docs

7. **`config/dev/secrets.env.example`** and **`config/prod/secrets.env.example`** (lines 20–29)
   - Rewrite the commented block to describe only `GOOGLE_CRED_FILE` + `GOOGLE_SERVICE_ACCOUNT_JSON` (inline JSON is a separate, unrelated option; keep it).

8. **`config/dev/public.env:19`** — already correct (`GOOGLE_CRED_FILE=...`). No change.

9. **Architecture docs** `docs/clasi/architecture/architecture-update-002.md` and `-004.md`
   - Add a one-line note "Renamed to `GOOGLE_CRED_FILE` out-of-process on 2026-04-20." Do not rewrite history — just annotate.

10. **`.claude/rules/api-integrations.md`** and **`.claude/rules/secrets.md`** (if they name the old vars)
    - Same one-line rename.

### Verification

11. Run `npm run test:server` — all tests pass.
12. Manual: restart dev server, sign in with a `@jointheleague.org` account, confirm staff OU lookup works. Open Admin → Sync → Sync Cohorts and confirm it returns 8 cohorts (same as before).

### Not in scope

- The inline `GOOGLE_SERVICE_ACCOUNT_JSON` path stays untouched — it's a different credential-input mode (JSON string vs. file path) and the stakeholder didn't ask to rename it.
- No schema changes, no new tickets, no CLASI artifacts — this is a small mechanical rename gated by the stakeholder's explicit "out of process" directive earlier in the session.
