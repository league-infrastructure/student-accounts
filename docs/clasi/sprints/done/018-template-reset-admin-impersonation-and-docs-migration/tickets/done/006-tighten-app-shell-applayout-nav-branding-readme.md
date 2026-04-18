---
id: '006'
title: Tighten app shell (AppLayout nav, branding, README)
status: done
use-cases:
- SUC-001
- SUC-002
depends-on:
- '002'
github-issue: ''
todo: plan-revert-template-app-to-simple-two-button-counter-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 006 — Tighten app shell (AppLayout nav, branding, README)

## Description

Verify and update `AppLayout.tsx` so the sidebar nav arrays reflect the desired structure,
remove all LEAGUEhub branding strings, and update `README.md` and `docs/template-spec.md`
to describe the template as a generic counter demo.

Depends on ticket 002 (domain pages deleted; nav links to them must already be gone).
Runs in Group 2 parallel with 003 and 004.

Note: AppLayout impersonation banner is NOT added here — that is ticket 009.

## Files to Modify

**`client/src/components/AppLayout.tsx`:**

Target nav structure:
```
MAIN_NAV:   [ { label: "Home",  path: "/" } ]
BOTTOM_NAV: [ { label: "MCP Setup", path: "/mcp-setup" },
              { label: "About",     path: "/about" } ]
ADMIN_NAV:  [ { label: "Configuration", path: "/admin/config",  adminOnly: true },
              { label: "Admin",         path: "/admin",          adminOnly: true } ]
```

Actions:
- Update `MAIN_NAV`, `BOTTOM_NAV`, `ADMIN_NAV` arrays to match the above.
- Add "Configuration" link pointing to `/admin/config`, visible only when
  `user.role === 'ADMIN'` (mirrors the existing Admin link pattern).
- Remove any nav entries pointing to deleted domain pages.
- Strip LEAGUEhub branding: "LEAGUE Progress Report" title strings, Pike13 logo URLs,
  `appName` defaulting to "LEAGUEhub" — replace with a generic placeholder
  (e.g., "Demo App" or read from `process.env.VITE_APP_NAME`).
- Verify topbar renders: hamburger (mobile) → spacer → avatar → displayName →
  role badge → dropdown with "Account" + "Log out".
- Verify `AppLayout` hides itself on `/login` and redirects unauthenticated users to
  `/login` (this should already work via `requireAuth` / `AuthContext`; just confirm).

**`README.md`:**
- Rewrite to describe the template as a generic Node/React/Docker starter.
- Describe the counter demo as the default home page.
- Remove LEAGUEhub, Pike13, instructor/student references.
- Keep Docker and CLASI setup instructions.

**`docs/template-spec.md`:**
- Update technology decisions section to remove Pike13/OAuth references.
- Describe demo login (username/password form, hardcoded credentials).
- Describe Counter as the example domain model.
- Note: this file will be migrated to `.claude/rules/` in ticket 010 — write it as if it
  will be migrated (it should remain accurate post-migration).

## Acceptance Criteria

- [x] `MAIN_NAV` contains only "Home"
- [x] `BOTTOM_NAV` contains "MCP Setup" and "About"
- [x] "Configuration" link (→ `/admin/config`) appears in sidebar for ADMIN role only
- [x] "Admin" link appears in sidebar for ADMIN role only
- [x] No sidebar links reference deleted domain pages
- [x] No "LEAGUEhub", "Pike13", "LEAGUE Progress Report" strings visible in the running app
- [x] `appName` default is no longer "LEAGUEhub"
- [x] Topbar shows username, role badge, and Account/Log out dropdown
- [x] `AppLayout` redirects unauthenticated users to `/login`
- [x] `README.md` describes a generic counter demo template (no LEAGUEhub mentions)
- [x] `docs/template-spec.md` reflects demo login and counter domain
- [x] `npm run build` (client) succeeds

## Implementation Plan

1. Read `AppLayout.tsx` in full to map current nav arrays and branding strings.
2. Update `MAIN_NAV`, `BOTTOM_NAV`, `ADMIN_NAV` arrays.
3. Add Configuration nav entry with adminOnly guard.
4. Search for and replace all LEAGUEhub/Pike13 branding strings.
5. Verify topbar and auth guard behavior (no code change expected, just confirm).
6. Rewrite `README.md`.
7. Update `docs/template-spec.md`.
8. Run `npm run build` (client).

## Testing

- **Existing tests to run**: `npm run test:client`
- **New tests to write**: None required (visual/structural verification is sufficient).
- **Verification command**: `npm run build && npm run test:client`
