---
id: '012'
title: Anthropic sync routes and SyncPanel Anthropic section
status: done
use-cases:
- SUC-010-006
- SUC-010-007
depends-on:
- 010-011
github-issue: ''
todo: plan-claude-team-account-management-real-admin-api-integration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Anthropic sync routes and SyncPanel Anthropic section

## Description

Wire the `AnthropicSyncService` and the probe helper into the admin API and
extend the `SyncPanel` UI with an Anthropic section. Depends on T011
(`AnthropicSyncService` + real Claude ops).

## Acceptance Criteria

**Backend routes:**
- [x] `server/src/routes/admin/anthropic-sync.ts` created and exports `anthropicSyncRouter`.
- [x] `POST /admin/sync/claude` runs `AnthropicSyncService.reconcile()`. Returns `SyncReport` as JSON. Returns 503 if the Anthropic API is unreachable.
- [x] `GET /admin/anthropic/probe` calls probe helper. Returns `{ ok: boolean, org: { id, name } | null, userCount: number | null, workspaces: string[], invitesCount: number | null, writeEnabled: boolean, error?: string }`.
- [x] `anthropicSyncRouter` mounted in `server/src/routes/admin/index.ts`.
- [x] Route-level tests for both endpoints.

**Frontend:**
- [x] `SyncPanel.tsx` gains a third section "Anthropic (Claude)" below the existing Google and Pike13 sections.
- [x] Section auto-loads probe data via `GET /api/admin/anthropic/probe` on mount. Renders: org name, user count, workspace list, write-enabled status. Shows error if probe fails.
- [x] "Sync Claude accounts" button POSTs to `POST /api/admin/sync/claude`. Shows spinner during sync. On success, renders `SyncReport` inline: created, linked, invitedAccepted, removed, and unmatched email list.
- [x] `npm run test:server` and `npm run test:client` pass.

## Implementation Plan

### New Files

**`server/src/routes/admin/anthropic-sync.ts`**

```typescript
import { Router } from 'express';
const router = Router();

router.post('/sync/claude', async (req, res) => {
  const report = await req.services.anthropicSync.reconcile();
  res.json(report);
});

router.get('/anthropic/probe', async (req, res) => {
  // Call probe helper (inline or shared with scripts/probe-anthropic-admin.mjs)
  ...
});
```

Probe helper: call `anthropicAdmin.listOrgUsers()`, `listWorkspaces()`, `listInvites()`
with limit=1; catch errors per-call; return structured result. Reuse the same fetch
logic from the script if possible (extract to a shared helper function in
`server/src/services/anthropic/probe.ts`).

### Files to Modify

**`server/src/routes/admin/index.ts`**
- Import `anthropicSyncRouter` and mount: `adminRouter.use('/admin', anthropicSyncRouter)` (check mount pattern against existing routers like `adminBulkCohortRouter`).

**`client/src/pages/admin/SyncPanel.tsx`**
- Add third section after existing sections.
- `useQuery(['anthropic-probe'], () => fetch('/api/admin/anthropic/probe').then(r => r.json()))` for probe data.
- `useMutation` for sync trigger; on success set local `syncReport` state.

### Testing Plan

**Route tests:** `tests/server/routes/admin/anthropic-sync.test.ts`
- Mock `AnthropicSyncService.reconcile()` to return a fake report.
- Assert `POST /admin/sync/claude` returns 200 with the report shape.
- Assert `GET /admin/anthropic/probe` returns 200 with `ok: true` when client is configured.
- Assert 403 for non-admin calls.

Run `npm run test:server` and `npm run test:client`.
