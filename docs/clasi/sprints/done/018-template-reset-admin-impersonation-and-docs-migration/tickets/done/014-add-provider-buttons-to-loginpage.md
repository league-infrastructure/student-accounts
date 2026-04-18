---
id: '014'
title: Add provider buttons to LoginPage
status: done
use-cases:
- SUC-008
- SUC-009
- SUC-010
depends-on:
- '011'
- '013'
github-issue: ''
todo: plan-social-login-account-linking-for-the-template-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 014 — Add provider buttons to LoginPage

## Description

The current `client/src/pages/Login.tsx` shows only the demo form. This ticket extends it
by adding a `useProviderStatus()` hook and rendering conditional provider buttons below the
demo form when the corresponding OAuth env vars are configured.

The demo form is untouched (stakeholder decision 1: always visible). Provider buttons
appear only when the backend reports a provider as configured. Clicking a button does a
browser redirect to `/api/auth/<provider>` — a full page navigation, not a fetch.

Depends on ticket 011 (backend routes must exist before the buttons can navigate anywhere)
and ticket 013 (`AuthUser.linkedProviders` field must exist for the hook shape to be
consistent with Account.tsx usage in ticket 015).

## Acceptance Criteria

- [x] `useProviderStatus()` hook created at `client/src/hooks/useProviderStatus.ts`
- [x] Hook calls `GET /api/integrations/status` on mount and returns `{ github: boolean, google: boolean, pike13: boolean, loading: boolean }`
- [x] When no providers are configured, only the demo form is visible on `/login` — identical to today
- [x] When GitHub is configured, a "Sign in with GitHub" button appears below the demo form
- [x] When Google is configured, a "Sign in with Google" button appears below the demo form
- [x] When Pike 13 is configured, a "Sign in with Pike 13" button appears below the demo form
- [x] Provider buttons appear below an "Or sign in with" divider (divider hidden when no providers configured)
- [x] Clicking a provider button navigates to `/api/auth/<provider>` (browser redirect)
- [x] Provider buttons use recognizable per-provider styling: GitHub dark (`#24292e`), Google white with border, Pike 13 orange (`#f37121`)
- [x] `AuthUser` type in `AuthContext.tsx` extended with `linkedProviders?: string[]`
- [x] Existing demo form behavior and appearance are unchanged

## Files to Create

- `client/src/hooks/useProviderStatus.ts` — new hook

## Files to Modify

- `client/src/pages/Login.tsx` — add divider and provider buttons below the existing form
- `client/src/context/AuthContext.tsx` — add `linkedProviders?: string[]` to `AuthUser` interface

## Implementation Plan

### `useProviderStatus` hook

```typescript
// client/src/hooks/useProviderStatus.ts
import { useEffect, useState } from 'react';

interface ProviderStatus {
  github: boolean;
  google: boolean;
  pike13: boolean;
  loading: boolean;
}

export function useProviderStatus(): ProviderStatus {
  const [status, setStatus] = useState<ProviderStatus>({
    github: false, google: false, pike13: false, loading: true,
  });

  useEffect(() => {
    fetch('/api/integrations/status')
      .then(r => r.json())
      .then((data: any) => {
        setStatus({
          github: !!data.github?.configured,
          google: !!data.google?.configured,
          pike13: !!data.pike13?.configured,
          loading: false,
        });
      })
      .catch(() => setStatus(s => ({ ...s, loading: false })));
  }, []);

  return status;
}
```

### Login.tsx extension

After the closing `</form>` tag, add:

```tsx
{!providerStatus.loading && (providerStatus.github || providerStatus.google || providerStatus.pike13) && (
  <>
    <div className="relative my-4">
      <div className="absolute inset-0 flex items-center">
        <div className="w-full border-t border-slate-200" />
      </div>
      <div className="relative flex justify-center text-sm">
        <span className="bg-white px-2 text-slate-400">Or sign in with</span>
      </div>
    </div>
    <div className="flex flex-col gap-2">
      {providerStatus.github && (
        <a href="/api/auth/github"
          className="flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ background: '#24292e' }}
        >
          GitHub
        </a>
      )}
      {providerStatus.google && (
        <a href="/api/auth/google"
          className="flex items-center justify-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-semibold text-slate-700"
        >
          Google
        </a>
      )}
      {providerStatus.pike13 && (
        <a href="/api/auth/pike13"
          className="flex items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm font-semibold text-white"
          style={{ background: '#f37121' }}
        >
          Pike 13
        </a>
      )}
    </div>
  </>
)}
```

Use `<a href=...>` not `<button onClick={() => navigate(...)}>` — OAuth flow requires a
true browser navigation to establish the redirect chain correctly.

### AuthContext.tsx type extension

```typescript
export interface AuthUser {
  // ... existing fields ...
  linkedProviders?: string[];
}
```

### Testing Plan

This ticket is frontend-only. Tests are manual smoke tests (no React testing library tests
are required by the sprint's test strategy):
- With no OAuth env vars: visit `/login` — confirm only demo form visible, no divider
- With `GITHUB_CLIENT_ID` set: visit `/login` — confirm GitHub button appears below divider
- Clicking GitHub button navigates to `/api/auth/github`

If a Vitest + React Testing Library setup exists, write a test for `useProviderStatus`
with a mocked `fetch` returning `{ github: { configured: true }, google: { configured: false }, pike13: { configured: false } }`.

## Testing

- **Existing tests to run**: `cd client && npm test` (if client test suite exists) — verify no regressions
- **New tests to write**: `useProviderStatus` hook unit test with mocked fetch (optional; if test infra exists)
- **Verification command**: Manual smoke test described above; `cd server && npm test` for backend regression check
