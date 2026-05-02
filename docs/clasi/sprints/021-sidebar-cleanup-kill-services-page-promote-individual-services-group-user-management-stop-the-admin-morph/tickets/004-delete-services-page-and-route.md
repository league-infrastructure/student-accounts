---
id: '004'
title: Delete Services page and route
status: done
use-cases:
- SUC-001
depends-on:
- '002'
- '003'
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Delete Services page and route

## Description

`Services.tsx` is now fully superseded:
- `ClaudeCodeSection` was extracted to `ClaudeCode.tsx` (ticket 002).
- `LlmProxySection` was extracted to `LlmProxy.tsx` (ticket 002).
- The Workspace block was restored to `Account.tsx` (ticket 003).
- The `ServicesSection` (workspace status table) content is duplicated in
  `Account.tsx` as of ticket 003; the version in Services is no longer needed.

Delete the file and its test. Remove the `/services` route from `App.tsx`.

## Acceptance Criteria

- [x] `client/src/pages/Services.tsx` is deleted.
- [x] `tests/client/pages/Services.test.tsx` is deleted.
- [x] `import Services from './pages/Services'` is removed from `client/src/App.tsx`.
- [x] `<Route path="/services" element={<Services />} />` is removed from `App.tsx`.
- [x] No TypeScript compilation errors after deletion.
- [x] `npm run test:client` passes.

## Implementation Plan

### Approach

1. Confirm tickets 002 and 003 are complete (ClaudeCode.tsx, LlmProxy.tsx, and
   Account workspace block all exist and pass their tests).
2. Delete `client/src/pages/Services.tsx`.
3. Delete `tests/client/pages/Services.test.tsx`.
4. Remove the `Services` import and route from `client/src/App.tsx`.
5. Run `npm run test:client` to confirm no new failures.
6. Optionally run `npx tsc --noEmit` from `client/` to catch any remaining
   imports of `Services`.

### Files to delete

- `client/src/pages/Services.tsx`
- `tests/client/pages/Services.test.tsx`

### Files to modify

- `client/src/App.tsx` — remove import and route

### Testing plan

- `npm run test:client` should pass (Services tests are deleted alongside the file).
- TypeScript check to catch dangling imports.

### Documentation updates

None — architecture-update.md already lists Services as deleted.
