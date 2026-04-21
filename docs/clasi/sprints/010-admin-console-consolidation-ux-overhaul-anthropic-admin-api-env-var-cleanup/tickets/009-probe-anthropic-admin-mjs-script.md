---
id: '009'
title: probe-anthropic-admin.mjs script
status: todo
use-cases:
  - SUC-010-008
depends-on:
  - "010-002"
github-issue: ''
todo: plan-claude-team-account-management-real-admin-api-integration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# probe-anthropic-admin.mjs script

## Description

Create a standalone Node.js ESM script that an operator can run to verify
`ANTHROPIC_ADMIN_API_KEY` is valid and the org is reachable. Useful for
initial setup, debugging, and as a CI smoke check.

The script does not depend on the compiled TypeScript server; it uses
`fetch` directly and can be run with `node scripts/probe-anthropic-admin.mjs`.

## Acceptance Criteria

- [ ] `scripts/probe-anthropic-admin.mjs` created as a standalone ESM script.
- [ ] Reads `ANTHROPIC_ADMIN_API_KEY` from the environment. Exits with a clear error if not set.
- [ ] Hits four endpoints: `GET /v1/organizations/me`, `GET /v1/organizations/users?limit=1`, `GET /v1/organizations/workspaces?limit=10`, `GET /v1/organizations/invites?limit=1`.
- [ ] Prints a single OK/FAIL summary line per endpoint with the response shape (org name, user count, workspace names, invite count).
- [ ] Exits with code 0 if all endpoints return 2xx; exits with non-zero if any fail.
- [ ] Works with `node scripts/probe-anthropic-admin.mjs` (no compilation step).
- [ ] Manual verification: running the script with the real `ANTHROPIC_ADMIN_API_KEY` set prints OK with "The League of Amazing Programmers" org name.

## Implementation Plan

### New Files

**`scripts/probe-anthropic-admin.mjs`**

Structure:
```javascript
#!/usr/bin/env node
const API_KEY = process.env.ANTHROPIC_ADMIN_API_KEY;
if (!API_KEY) { console.error('ANTHROPIC_ADMIN_API_KEY not set'); process.exit(1); }

const BASE = 'https://api.anthropic.com/v1';
const headers = { 'x-api-key': API_KEY, 'anthropic-version': '2023-06-01' };

async function probe(label, url) { ... }

const results = await Promise.all([
  probe('org/me',        `${BASE}/organizations/me`),
  probe('users',         `${BASE}/organizations/users?limit=1`),
  probe('workspaces',    `${BASE}/organizations/workspaces?limit=10`),
  probe('invites',       `${BASE}/organizations/invites?limit=1`),
]);

const ok = results.every(r => r.ok);
console.log(ok ? 'OK' : 'FAIL');
process.exit(ok ? 0 : 1);
```

Print each result inline:
```
OK  org/me         → "The League of Amazing Programmers" (id: c256784d-...)
OK  users          → 1 user(s)
OK  workspaces     → ["Students"]
OK  invites        → 0 pending invite(s)
```

### Testing Plan

No automated tests for this script (it would require real credentials or a
mock server). Manual verification is sufficient.

Document in the script header: `Usage: ANTHROPIC_ADMIN_API_KEY=<key> node scripts/probe-anthropic-admin.mjs`
