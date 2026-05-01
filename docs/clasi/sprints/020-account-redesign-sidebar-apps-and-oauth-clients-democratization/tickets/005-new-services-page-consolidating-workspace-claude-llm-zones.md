---
id: "005"
title: "New Services page consolidating Workspace Claude LLM zones"
status: todo
use-cases:
  - SUC-020-004
depends-on:
  - "001"
github-issue: ""
todo: "plan-account-page-redesign-sidebar-app-migration-oauth-clients-democratization.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# New Services page consolidating Workspace Claude LLM zones

## Description

Create `client/src/pages/Services.tsx`, mounted at `/services` under
`AppLayout`. This page absorbs the JSX/logic of `ServicesSection`,
`ClaudeCodeSection`, and `AccountLlmProxyCard` from the current
`Account.tsx`, plus the Workspace temp-password surfacing behaviour.
See `architecture-update.md` § "Modified Modules (Client)" and use
case **SUC-020-004**.

**Move, don't rewrite.** Lift the existing components/hooks
verbatim where possible — preserve their queries, mutations, and
loading/error states. Ticket 001 already removed AppsZone; ticket
004 will remove ServicesSection / ClaudeCodeSection / AccountLlmProxyCard
from Account.tsx (so this ticket and ticket 004 may both touch
Account.tsx; see Sequencing). The actual displaced JSX should land
intact in Services.tsx.

**Conditional rendering by role + entitlements.**

- Workspace status / temp-password block: same audience as today
  (anyone with a `gws_email` / Workspace account in scope; match
  the existing `ServicesSection` gating).
- Claude Code section: only when the user has Claude access
  (match the current `ClaudeCodeSection` predicate).
- LLM Proxy card: only when the user has an LLM proxy token, OR is a
  staff/admin who can request one (match
  `AccountLlmProxyCard`'s current predicate).
- **Empty state**: if none of the above sections apply, show a
  friendly message — e.g. "No external services are linked to your
  account yet." Match the visual style of other empty states in the
  app (search for existing empty-state components).

**Workspace temp password.** SUC-020-004 acceptance: "Workspace temp
password still surfaces here on first view (matching previous Account
behaviour)." Whatever mechanism the current ServicesSection uses to
surface the one-time temp password (likely a query param or a
short-lived flag in the GET account response) must continue to work
when the user lands on `/services`. Verify by inspecting the
existing surfacing behaviour and porting it intact.

**Routing.** Add a `<Route path="/services" element={<Services />} />`
to `client/src/App.tsx` under the `AppLayout` wrapper (mirror how
`/account` is wired).

## Acceptance Criteria

- [ ] `client/src/pages/Services.tsx` exists, mounted at `/services` under `AppLayout` in `client/src/App.tsx`.
- [ ] Workspace status, Claude Code, and LLM Proxy zones each render under the same conditions they did on `Account.tsx`.
- [ ] Friendly empty state shows when none of the three zones apply.
- [ ] Workspace temp-password first-view surfacing still works (regression check).
- [ ] No new server endpoints; this is a pure client refactor.
- [ ] `npm run test:client` passes; baseline holds.

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write** (`tests/client/pages/Services.test.tsx`):
  - Student with all entitlements (Workspace + Claude + LLM token) — all three sections render.
  - Staff without LLM token — Workspace + Claude render; LLM Proxy card shows the "request a token" affordance (or hides, depending on existing predicate — match it).
  - User with none of the three — empty-state message renders, no zone markers present.
  - Workspace temp-password surfaces on first render when the account payload signals it (mock the account query accordingly).
  - Mounted route `/services` resolves to the Services page within `AppLayout` (smoke render).
- **Verification command**: `npm run test:client -- Services`
