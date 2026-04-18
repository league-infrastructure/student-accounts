---
id: '013'
title: Extend auth/me with linkedProviders and add unlink endpoint
status: done
use-cases:
- SUC-011
- SUC-012
depends-on:
- '011'
github-issue: ''
todo: plan-social-login-account-linking-for-the-template-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 013 — Extend auth/me with linkedProviders and add unlink endpoint

## Description

The Account page (ticket 015) needs to know which providers are linked to the current user
so it can render the "Sign-in methods" section. This ticket extends `GET /api/auth/me` to
include a `linkedProviders` array, and adds `POST /api/auth/unlink/:provider` with the
unlink guardrail (decision 4: must leave at least one remaining login method).

This ticket depends on ticket 011 because `UserProvider` rows are created by the OAuth
flows introduced there — the endpoint would be meaningless without them.

Can run in parallel with ticket 012 (Pike 13 wiring). The `linkedProviders` field is
provider-agnostic and will include Pike 13 providers once ticket 012 creates them.

## Acceptance Criteria

- [x] `GET /api/auth/me` response includes `linkedProviders: string[]`
- [x] `linkedProviders` is the union of `User.provider` (if not null) and all `UserProvider.provider` values for the current user, deduplicated
- [x] A user with no OAuth logins (pure demo-form user) gets `linkedProviders: []`
- [x] `POST /api/auth/unlink/:provider` requires an authenticated session; returns 401 if not authenticated
- [x] Unlink deletes the `UserProvider` row for `{ userId: req.user.id, provider: req.params.provider }`
- [x] If `User.provider` matches the unlinked provider, clears `User.provider` and `User.providerId` to null
- [x] Guardrail: if unlinking would leave the user with zero remaining login methods, returns 400 with a clear error message; no rows are modified
- [x] Guardrail counts: `UserProvider` rows + 1 if `User.provider` is non-null (counting both before the delete)
- [x] Unlink of a provider not linked to this user returns 404
- [x] On success, returns `{ success: true, linkedProviders: string[] }` (updated list)

## Files to Modify

- `server/src/routes/auth.ts` — extend `GET /api/auth/me` handler and add `POST /auth/unlink/:provider` route

## Files to Create

None.

## Implementation Plan

### Extend GET /api/auth/me

Current response shape (from Sprint 018):
```typescript
res.json({
  id, email, displayName, role, avatarUrl,
  provider, providerId,
  createdAt, updatedAt,
  impersonating, realAdmin,
});
```

Add `linkedProviders`:

```typescript
// Fetch UserProvider rows for this user
const providerRows = await prisma.userProvider.findMany({
  where: { userId: user.id },
  select: { provider: true },
});
const linked = new Set<string>(providerRows.map(r => r.provider));
if (user.provider) linked.add(user.provider);

res.json({
  // ... existing fields ...
  linkedProviders: [...linked],
});
```

Note: This adds one DB query per `/api/auth/me` call. Acceptable for a demo template.

### POST /api/auth/unlink/:provider

```typescript
authRouter.post('/auth/unlink/:provider', requireAuth, async (req, res) => {
  const user = req.user as any;
  const { provider } = req.params;

  // Count remaining methods before unlink
  const providerRows = await prisma.userProvider.findMany({
    where: { userId: user.id },
  });
  const isPrimary = user.provider === provider;
  const hasProviderRow = providerRows.some(r => r.provider === provider);

  if (!hasProviderRow && !isPrimary) {
    return res.status(404).json({ error: 'Provider not linked to this account' });
  }

  // Remaining after unlink:
  // (providerRows.length - (hasProviderRow ? 1 : 0)) + (isPrimary && !hasProviderRow ? 0 : (user.provider ? 1 : 0) - (isPrimary ? 1 : 0))
  // Simpler: count total methods, subtract 1
  const totalMethods = providerRows.length + (user.provider ? 1 : 0);
  // Deduplicate: if primary provider also has a UserProvider row, don't double-count
  const primaryAlsoHasRow = isPrimary && hasProviderRow;
  const effectiveMethods = primaryAlsoHasRow
    ? providerRows.length  // primary is covered by the row
    : providerRows.length + (user.provider ? 1 : 0);

  if (effectiveMethods <= 1) {
    return res.status(400).json({
      error: 'Cannot unlink: this is your only remaining login method',
    });
  }

  // Delete UserProvider row if it exists
  if (hasProviderRow) {
    await prisma.userProvider.deleteMany({
      where: { userId: user.id, provider },
    });
  }

  // Clear primary provider fields if this was the primary
  if (isPrimary) {
    await prisma.user.update({
      where: { id: user.id },
      data: { provider: null, providerId: null },
    });
  }

  // Return updated linkedProviders
  const remaining = await prisma.userProvider.findMany({
    where: { userId: user.id },
    select: { provider: true },
  });
  const updatedUser = await prisma.user.findUnique({ where: { id: user.id } });
  const linked = new Set(remaining.map(r => r.provider));
  if (updatedUser?.provider) linked.add(updatedUser.provider);

  res.json({ success: true, linkedProviders: [...linked] });
});
```

Note: `requireAuth` middleware must be imported (it already exists in the codebase as
`middleware/requireAuth.ts`). The counting logic handles the edge case where `User.provider`
is the same provider as a `UserProvider` row (deduplication).

### Testing Plan

Tests in `server/src/routes/auth.test.ts`:
- `GET /api/auth/me` with no providers linked → `linkedProviders: []`
- `GET /api/auth/me` with one `UserProvider` row → `linkedProviders: ['github']`
- `GET /api/auth/me` with primary + UserProvider rows → deduplicated list
- `POST /api/auth/unlink/github` unauthenticated → 401
- `POST /api/auth/unlink/github` provider not linked → 404
- `POST /api/auth/unlink/github` with only one method → 400
- `POST /api/auth/unlink/github` with two methods → 200, row deleted, updated list returned
- `POST /api/auth/unlink/github` where github is primary → primary fields cleared to null
- Cross-user: cannot unlink another user's provider (implicit: `userId: req.user.id` in query)

Use `POST /api/auth/test-login` to establish sessions and seed `UserProvider` rows via
Prisma directly in test setup.

## Testing

- **Existing tests to run**: `cd server && npm test` — verify existing auth/me tests still pass
- **New tests to write**: `/auth/me` linkedProviders field, all unlink guardrail cases (listed above)
- **Verification command**: `cd server && npm test`
