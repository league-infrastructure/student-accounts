---
id: '007'
title: PassphraseModal component + live-TTL passphrase card on CohortDetailPanel and GroupDetailPanel
status: todo
use-cases:
  - SUC-001
  - SUC-002
  - SUC-003
depends-on:
  - '004'
  - '005'
  - '006'
github-issue: ''
todo: plan-passphrase-self-onboarding.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 007 — PassphraseModal component + live-TTL passphrase card on CohortDetailPanel and GroupDetailPanel

## Description

Build the admin UI for passphrase management. Two pieces: the `PassphraseModal` (create/regenerate dialog) and the passphrase card inline in each detail page (live TTL, copy, revoke). The card uses React Query with the existing SSE invalidation hook, so it stays current without polling.

## Acceptance Criteria

### PassphraseModal (`client/src/components/PassphraseModal.tsx`)

- [ ] Props: `{ isOpen: boolean; scope: { kind: 'group' | 'cohort'; id: number; name: string }; onClose(): void; onCreated(result: PassphraseRecord): void }`.
- [ ] Opens with a pre-filled three-word passphrase in an editable text input (generated client-side using the same word-list pattern, or a static placeholder replaced on mount via a fetch).
- [ ] "Regenerate" button replaces the input with a newly generated suggestion.
- [ ] Checkbox: "Also grant an LLM proxy token when students sign up" (defaults unchecked).
- [ ] "Cancel" closes the modal without saving.
- [ ] "Create" POSTs to `POST /admin/cohorts/:id/passphrase` or `POST /admin/groups/:id/passphrase` depending on `scope.kind`, body `{ plaintext, grantLlmProxy }`.
- [ ] On success: calls `onCreated(result)` and closes.
- [ ] On error: shows inline error.
- [ ] Modeled on `client/src/components/LlmProxyGrantModal.tsx`.

### Passphrase card in CohortDetailPanel

- [ ] Rendered directly under the "Sync to group" box in `client/src/pages/admin/CohortDetailPanel.tsx`.
- [ ] Data fetched from `GET /admin/cohorts/:id/passphrase` using React Query key `['admin', 'cohorts', id, 'passphrase']`.
- [ ] Cache invalidated by the SSE `cohorts` topic (via existing `useAdminEventStream.ts` — add the key to the invalidation set if not already covered).
- [ ] **Empty state** (404 or no active passphrase): shows a "Create passphrase" button that opens `PassphraseModal`.
- [ ] **Active state**: shows passphrase plaintext in monospace + selectable text, live "expires in Xm Ys" countdown via `setInterval(1000)`, Copy button, Regenerate button (opens modal again with current passphrase pre-filled), Revoke button, and a checkmark indicator if `grantLlmProxy` is true.
- [ ] When `expiresAt` passes: card flips back to empty state automatically (no page refresh needed).
- [ ] Revoke button calls `DELETE /admin/cohorts/:id/passphrase` and invalidates the query.

### Passphrase card in GroupDetailPanel

- [ ] Rendered directly under the header/toolbar in `client/src/pages/admin/GroupDetailPanel.tsx`.
- [ ] Identical behavior to the cohort card; uses `['admin', 'groups', id, 'passphrase']` React Query key and `groups` SSE topic.

### Tests

- [ ] `tests/client/PassphraseModal.test.tsx` created and green:
  - Renders with a pre-filled passphrase input.
  - "Regenerate" changes the input value.
  - LLM proxy checkbox toggles.
  - Submit calls `POST /admin/cohorts/:id/passphrase` (or groups) with correct body.
  - Cancel closes without calling the API.
- [ ] `npx tsc --noEmit` in `client/` shows no new errors.
- [ ] `npm run test:client` passes with the new suite included.

## Implementation Plan

### Approach

`PassphraseModal` follows the `LlmProxyGrantModal` pattern exactly: controlled by `isOpen`, calls `onCreated` on success. The card inline state is managed by React Query + a `useEffect` interval for the TTL countdown. Keep the countdown in a local `useState` rather than re-fetching.

### Files to Create

- `client/src/components/PassphraseModal.tsx`
- `tests/client/PassphraseModal.test.tsx`

### Files to Modify

- `client/src/pages/admin/CohortDetailPanel.tsx` — add passphrase card section.
- `client/src/pages/admin/GroupDetailPanel.tsx` — add passphrase card section.
- `client/src/hooks/useAdminEventStream.ts` — ensure `cohorts` and `groups` topics invalidate the passphrase card query keys (may already be covered).

### Testing Plan

- Component tests as described.
- `npx tsc --noEmit` in `client/`.
- `npm run test:client`.
- Manual smoke (Ticket 009) verifies TTL countdown and SSE invalidation end-to-end.

### Documentation Updates

None.
