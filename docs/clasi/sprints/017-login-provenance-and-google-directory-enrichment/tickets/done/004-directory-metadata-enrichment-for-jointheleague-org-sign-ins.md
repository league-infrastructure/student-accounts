---
id: '004'
title: Directory metadata enrichment for jointheleague.org sign-ins
status: done
use-cases:
- SUC-017-002
depends-on:
- '002'
- '003'
github-issue: ''
todo: plan-single-sign-on-oauth-provider-migration.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Directory metadata enrichment for jointheleague.org sign-ins

## Description

In the existing Step 4 `@jointheleague.org` branch of `signInHandler`,
after the OU has been determined, also call `listUserGroups` and write
the combined result to `Login.directory_metadata`.

**Modify `server/src/services/auth/sign-in.handler.ts`:**

After the existing OU lookup completes (regardless of whether the user
was promoted to staff or not), call:

```ts
let groups: UserGroup[] = [];
try {
  groups = await adminDirClient.listUserGroups(providerEmail);
} catch (err) {
  logger.warn({ providerEmail, err }, '[sign-in.handler] listUserGroups failed — continuing without groups');
}

const directoryMetadata = { ou_path: ouPath ?? null, groups };
await prisma.login.update({
  where: { id: login.id },
  data: { directory_metadata: directoryMetadata as any },
});
```

The OU portion (`ou_path`) reuses the value already captured in the
existing OU-lookup block. If the OU call also failed (StaffOULookupError),
the existing fail-secure path runs and we never reach this code — that's
correct.

If `listUserGroups` is missing from the injected client (test scenarios
that didn't configure it), guard with a typeof check and skip the call.

**Fail-soft contract:** sign-in MUST succeed even if `listUserGroups`
throws or the prisma update fails. Catch and log; do not rethrow.

## Acceptance Criteria

- [x] After a Google sign-in for a `@jointheleague.org` user, `Login.directory_metadata` is set to `{ ou_path, groups }`.
- [x] Non-Google sign-ins leave `directory_metadata` null.
- [x] Non-`@jointheleague.org` Google sign-ins leave `directory_metadata` null.
- [x] When `listUserGroups` throws, sign-in still completes (302 redirect, session established) and `directory_metadata` may be `{ ou_path, groups: [] }` or null — either is acceptable.
- [x] When the prisma update for `directory_metadata` throws, sign-in still completes; the failure is logged.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**:
  - In `tests/server/services/auth/sign-in.handler.test.ts`, add: `@jointheleague.org` sign-in with a `FakeGoogleWorkspaceAdminClient` configured with both OU and groups → `directory_metadata` populated.
  - `@jointheleague.org` sign-in with `listUserGroups` configured to throw → sign-in still resolves; user record exists; `directory_metadata` may be partial or null.
  - `@students.jointheleague.org` sign-in (skipped OU lookup) → `directory_metadata` null.
- **Verification command**: `npm run test:server`
