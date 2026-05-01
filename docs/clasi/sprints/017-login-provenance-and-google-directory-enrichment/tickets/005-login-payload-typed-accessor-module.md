---
id: "005"
title: "login-payload typed accessor module"
status: todo
use-cases: [SUC-017-003]
depends-on: ["001"]
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# login-payload typed accessor module

## Description

Create `server/src/services/auth/login-payload.ts` — a pure module of
typed accessors over the `Login.provider_payload` and
`Login.directory_metadata` JSON fields. Storage stays generic (Prisma
`Json`); consumers read through these helpers so a future schema change
or alternative provider can be absorbed in one file.

**File:** `server/src/services/auth/login-payload.ts`

Exports (all pure — no I/O, no async, no Prisma calls):

```ts
import type { Login } from '../../generated/prisma/client.js';

export interface GoogleDirectoryMetadata {
  ou_path: string | null;
  groups: { id: string; name: string; email: string }[];
}

/** Returns the Google groups for a Login, or empty array if absent or non-Google. */
export function getGoogleGroups(login: Login): { id: string; name: string; email: string }[];

/** Returns the Google OU path, or null if absent or non-Google. */
export function getGoogleOu(login: Login): string | null;

/** Returns the GitHub username from the GitHub provider payload, or null. */
export function getGitHubLogin(login: Login): string | null;

/** Returns the Pike13 person id from the Pike13 provider payload, or null. */
export function getPike13Id(login: Login): string | null;
```

Each helper:
- Returns `null` (or `[]` for arrays) when the field is absent.
- Type-guards the JSON shape — never throws on unexpected data; returns null instead.
- Does not assume the provider matches; e.g., `getGoogleGroups` checks `login.provider === 'google'` and returns `[]` for other providers.

## Acceptance Criteria

- [ ] `server/src/services/auth/login-payload.ts` exists with the four exports above.
- [ ] Each helper is a pure function (no imports of `prisma`, no `await`).
- [ ] Helpers handle `null` inputs gracefully — return `null` / `[]`.
- [ ] Unit tests cover: populated, null, wrong-provider, malformed-json paths.
- [ ] No new typecheck errors.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - `tests/server/services/auth/login-payload.test.ts` — table-driven unit tests (no DB needed; construct fake `Login` objects in-memory).
- **Verification command**: `npm run test:server`
