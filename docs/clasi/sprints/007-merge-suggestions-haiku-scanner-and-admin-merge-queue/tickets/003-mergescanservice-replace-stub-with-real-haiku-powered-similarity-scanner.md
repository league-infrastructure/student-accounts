---
id: "003"
title: "MergeScanService — replace stub with real Haiku-powered similarity scanner"
status: todo
use-cases: [SUC-007-001]
depends-on: ["002"]
github-issue: ""
todo: ""
---

# MergeScanService — replace stub with real Haiku-powered similarity scanner

## Description

Replace `server/src/services/auth/merge-scan.stub.ts` with a real implementation
at the same file path (or create `merge-scan.service.ts` and update the stub to
re-export from it — the critical requirement is that the import path used by
`sign-in.handler.ts` and `service.registry.ts` remains unchanged).

The implementation:
1. Skips the scan entirely for users with `role=staff`.
2. Loads all other existing User records (with their Pike13 ExternalAccount IDs
   and cohort names via `include`) as candidates — excluding the new user.
3. Iterates candidates. For each pair, calls `HaikuClient.evaluate()`.
4. If `confidence >= MERGE_SCAN_CONFIDENCE_THRESHOLD` (default 0.6): calls
   `MergeSuggestionRepository.create()` with canonicalised pair order
   (lower `id` first for `user_a_id`).
5. Writes an `AuditEvent` for each suggestion created.
6. Catches all errors per-pair; logs at ERROR; continues to next candidate.
7. When no candidates exist, returns immediately with no API calls.

## Acceptance Criteria

- [ ] `merge-scan.stub.ts` is replaced (or re-exports from `merge-scan.service.ts`);
      existing call sites in `sign-in.handler.ts` and `service.registry.ts` work
      without modification.
- [ ] Scan is skipped (no API calls) for `role=staff` users.
- [ ] Scan is skipped (no API calls) when no other users exist.
- [ ] For a new user with 2 candidates: `HaikuClient.evaluate` is called twice.
- [ ] Pairs with `confidence >= 0.6` result in a `MergeSuggestion` row in the database.
- [ ] Pairs with `confidence < 0.6` produce no rows.
- [ ] Duplicate pair (unique constraint violation) is caught silently; scan continues.
- [ ] `HaikuApiError` or `HaikuParseError` is caught, logged at ERROR, scan continues;
      User creation is NOT rolled back.
- [ ] An `AuditEvent` with `action=merge_suggestion_created` is written for each
      suggestion created.
- [ ] `MERGE_SCAN_CONFIDENCE_THRESHOLD` env var overrides the 0.6 default.

## Implementation Plan

### Approach

1. Create `server/src/services/auth/merge-scan.service.ts`.
2. Import `HaikuClient` from `../merge/haiku.client.js`.
3. Import `MergeSuggestionRepository`, `AuditService`, Prisma client.
4. Implement `mergeScan(user: User): Promise<void>` with the logic above.
5. Update `server/src/services/auth/merge-scan.stub.ts` to be a thin re-export
   pointing at `merge-scan.service.ts`, so no import paths change:
   `export { mergeScan } from './merge-scan.service.js';`

### Files to Create/Modify

- `server/src/services/auth/merge-scan.service.ts` — new (the real implementation)
- `server/src/services/auth/merge-scan.stub.ts` — change to thin re-export
- No changes to `sign-in.handler.ts` or `service.registry.ts`

### Testing Plan

- Integration test in `tests/server/` using a real SQLite test DB (per project
  testing conventions):
  - Seed two users (A and B existing, C is new).
  - Inject a fake `HaikuClient` that returns `{ confidence: 0.8, rationale: 'same person' }`.
  - Call `mergeScan(C)`.
  - Assert `MergeSuggestion` rows were created for `(B, C)` and `(A, C)` (or similar).
- Unit test: fake `HaikuClient` returns confidence 0.5 → no rows created.
- Unit test: `HaikuApiError` thrown → no crash; scan continues for other pairs.
- Unit test: `role=staff` user → no `HaikuClient.evaluate` calls.

### Documentation Updates

Add `MERGE_SCAN_CONFIDENCE_THRESHOLD` to `config/dev/public.env` as a commented
default entry with value `0.6` for discoverability.
