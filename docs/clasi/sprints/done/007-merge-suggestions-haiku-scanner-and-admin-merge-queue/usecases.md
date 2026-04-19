---
sprint: "007"
status: active
---

# Sprint 007 — Use Cases

Sprint-level use cases for Merge Suggestions: Haiku Scanner and Admin Merge Queue.

Sprint use case IDs are prefixed `SUC-007-NNN` and trace to the project-level use
cases in `docs/clasi/design/usecases.md`.

---

## SUC-007-001: Haiku Similarity Scan Runs After User Creation

**Traces to:** UC-018

**Actor:** System (triggered on any new User creation path)

**Trigger:** A new User record is created via:
- Google OAuth sign-in (UC-001)
- GitHub OAuth sign-in (UC-002)
- Pike13 sync (UC-004)

**Preconditions:**
- Newly created User record exists in the database.
- `ANTHROPIC_API_KEY` is set in the environment.
- `MERGE_SCAN_CONFIDENCE_THRESHOLD` is set (or defaults to `0.6`).

**Main Flow:**
1. `mergeScan(newUser)` is invoked after User creation (the stub at
   `server/src/services/auth/merge-scan.stub.ts` is replaced wholesale by
   `merge-scan.service.ts` at the same import path).
2. Service loads all existing User records excluding the new user (the candidate pool).
3. For each candidate, the service constructs a structured comparison prompt containing
   display names, primary emails, Pike13 external account ID (if present), cohort name
   (if present), created_via, and creation date.
4. The prompt is submitted to the Anthropic API using the `claude-haiku-4-5` model via
   `HaikuClient`.
5. Haiku returns a JSON response containing `confidence` (0.0–1.0) and `rationale`
   (short string).
6. If `confidence >= threshold` (default 0.6): a `MergeSuggestion` record is created
   with `status=pending`, `haiku_confidence`, `haiku_rationale`.
7. If `confidence < threshold`: the pair is discarded; no record is created.
8. An `AuditEvent` is written for each MergeSuggestion created:
   `action=merge_suggestion_created`, `target_user_id=newUser.id`,
   `details.candidate_user_id`, `details.haiku_confidence`, `details.haiku_rationale`.

**Acceptance Criteria:**
- [ ] `merge-scan.stub.ts` is replaced by `merge-scan.service.ts` exporting
      `mergeScan(user: User): Promise<void>` at the same import path.
- [ ] `MergeSuggestionRepository.create()` is called for each pair with confidence >= 0.6.
- [ ] Pairs with confidence < 0.6 produce no MergeSuggestion rows.
- [ ] A duplicate pair (same `user_a_id` / `user_b_id`) is handled via upsert or
      caught silently — no crash on unique constraint violation.
- [ ] Anthropic API failure is logged at ERROR and the scan continues for remaining
      candidates; User creation is not rolled back.
- [ ] An AuditEvent is written for each MergeSuggestion created.
- [ ] The scan is skipped entirely for users with `role=staff`.
- [ ] When no other users exist, scan completes immediately with no API calls.

**Error Flows:**
- Anthropic API unavailable / timeout: failure is logged; User creation succeeds.
- Anthropic API returns malformed JSON: error is logged; that pair is skipped.
- `MergeSuggestion` unique constraint violation: caught silently; no error surfaced.

---

## SUC-007-002: Admin Views Pending Merge Queue

**Traces to:** UC-019 (list step)

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- One or more `MergeSuggestion` records exist with `status=pending` or `status=deferred`.

**Main Flow:**
1. Administrator navigates to `/admin/merge-queue`.
2. App fetches `GET /admin/merge-queue` and displays the list of pending and deferred
   suggestions.
3. Each row shows: User A name + email, User B name + email, confidence score
   (formatted as a percentage), rationale text, status badge, and a "Review" button.
4. List is ordered by `created_at` ascending (FIFO — oldest first).
5. The count of pending suggestions is shown in the page header.

**Acceptance Criteria:**
- [ ] `GET /admin/merge-queue` returns all MergeSuggestions with `status` in
      `[pending, deferred]`, including joined User A and User B display data.
- [ ] The admin UI page `MergeQueuePanel.tsx` renders the list at route
      `/admin/merge-queue`.
- [ ] The page is accessible from the admin nav sidebar (`ADMIN_NAV` includes
      Merge Queue link).
- [ ] An empty queue displays a "No pending merge suggestions" message.
- [ ] The response includes `haiku_confidence` and `haiku_rationale` for display.

---

## SUC-007-003: Admin Reviews and Acts on a Merge Suggestion

**Traces to:** UC-019 (detail + action steps)

**Actor:** Administrator

**Preconditions:**
- Administrator is signed in.
- A specific `MergeSuggestion` with `status=pending` or `status=deferred` exists.

**Main Flow (Approve):**
1. Administrator clicks "Review" on a suggestion to open the detail view.
2. Detail view shows side-by-side comparison of User A and User B:
   display name, email, Logins (provider + email), ExternalAccounts (type + status),
   cohort, created_at, created_via, confidence score, rationale.
3. Administrator selects which user is the survivor via a radio selector.
4. Administrator clicks "Approve Merge."
5. App calls `POST /admin/merge-queue/:id/approve` with `{ survivorId }`.
6. Server executes merge in a single database transaction:
   a. Move all Logins from the non-survivor to the survivor.
   b. Move all ExternalAccounts from the non-survivor to the survivor.
   c. Cohort: if survivor has no cohort and non-survivor does, survivor inherits
      non-survivor's cohort.
   d. Non-survivor User is deactivated: `is_active` set to `false`.
   e. MergeSuggestion `status=approved`, `decided_by`, `decided_at` set.
   f. AuditEvent: `action=merge_approve`, `actor_user_id`, details with
      `user_a_id`, `user_b_id`, `survivor_id`.
7. Transaction failure (e.g., duplicate Login constraint): rollback; both Users
   unchanged; error surfaced to administrator.
8. App returns to the merge queue list.

**Main Flow (Reject):**
1. Administrator clicks "Reject."
2. App calls `POST /admin/merge-queue/:id/reject`.
3. Server sets `status=rejected`, `decided_by`, `decided_at`.
4. AuditEvent: `action=merge_reject`.
5. App returns to the merge queue list.

**Main Flow (Defer):**
1. Administrator clicks "Defer."
2. App calls `POST /admin/merge-queue/:id/defer`.
3. Server sets `status=deferred`. `decided_by` and `decided_at` remain null.
4. Suggestion remains visible in queue listing (deferred shown alongside pending).

**Acceptance Criteria:**
- [ ] Detail view shows all Logins and ExternalAccounts for both users.
- [ ] Approve: all Logins migrated to survivor atomically.
- [ ] Approve: all ExternalAccounts migrated to survivor atomically.
- [ ] Approve: non-survivor has `is_active=false` after merge.
- [ ] Approve: MergeSuggestion status updated and AuditEvent written in same transaction.
- [ ] Approve: full transaction rollback on constraint violation; error message shown.
- [ ] Reject: `status=rejected`; AuditEvent written.
- [ ] Defer: `status=deferred`; suggestion remains visible in queue.
- [ ] A suggestion with `status=approved` or `status=rejected` cannot be re-acted on
      (server returns 409).

**Error Flows:**
- Duplicate Login on survivor after re-parent: entire approve transaction rolls back.
- Suggestion already decided: `POST` returns 409; admin sees error message.

---

## SUC-007-004: Non-Survivor User Is Deactivated After Merge

**Traces to:** UC-019 (Approve postcondition)

**Actor:** System (part of approve flow in SUC-007-003)

**Main Flow:**
1. After Logins and ExternalAccounts are moved to the survivor, the non-survivor
   User record is updated: `is_active = false`.
2. The non-survivor no longer appears in normal user listings (user queries filter
   `is_active = true` by default).
3. The non-survivor's record is retained for audit and historical purposes; it can
   still be fetched by ID from the admin detail view.

**Acceptance Criteria:**
- [ ] `User` model gains `is_active Boolean @default(true)` (schema migration).
- [ ] After merge approve, non-survivor has `is_active=false`.
- [ ] `UserService.findAll()` and user listing queries default to `is_active=true`.
- [ ] Admin user detail route can still fetch an inactive user by ID.
- [ ] Existing users all have `is_active=true` after migration (no disruption).
