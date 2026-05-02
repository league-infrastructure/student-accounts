---
id: "003"
title: "Test — AppLayout loading-to-resolved hook-order regression"
status: todo
use-cases:
  - SUC-022-004
depends-on: []
github-issue: ""
todo: ""
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Test — AppLayout loading-to-resolved hook-order regression

## Description

Sprint 021 fixed a hook-order bug in `AppLayout.tsx` by moving the
`useQuery(['account'])` call above the `if (loading)` conditional early
return. Without this fix, React would throw an "Rendered more hooks than
during the previous render" error when auth state transitioned from
`loading: true` to `loading: false`, because hooks were being called a
different number of times on each render cycle.

The fix is in production, but it was never covered by a test. The existing
`AppLayout.test.tsx` suite mocks `useAuth` to return `{ loading: false, user: {...} }`
immediately, so the failing path — where `loading` starts true and transitions
to false — is never exercised.

This ticket adds a regression test that mounts AppLayout with `loading: true`,
then transitions to `loading: false`, and asserts that:
- The loading spinner renders in phase 1.
- The sidebar renders correctly in phase 2.
- No React hook-order error is thrown.

## Acceptance Criteria

- [ ] A new describe block "AppLayout — loading to resolved transition" exists
      in `tests/client/AppLayout.test.tsx`.
- [ ] The test mounts AppLayout with `useAuth` returning `loading: true`.
- [ ] The test asserts the loading spinner (text "Loading..." or aria attribute)
      is visible in the initial render.
- [ ] The test updates the `useAuth` mock to return `loading: false` with a
      valid user and triggers a re-render.
- [ ] The test asserts that the sidebar nav item "Account" is visible after
      the transition.
- [ ] No React "hook count changed" warning or error is thrown during the
      transition (the test will fail with an uncaught error if it occurs).
- [ ] Existing AppLayout tests continue to pass.
- [ ] Client test suite passes at or above baseline.

## Implementation Plan

### Approach

Use Vitest's `mockReturnValueOnce` / `mockReturnValue` sequence on the
`useAuth` mock to simulate the two-phase render. React Testing Library's
`rerender` API (from the `render` return value) triggers the state change.

```ts
describe('AppLayout — loading to resolved transition', () => {
  it('renders sidebar after auth resolves without hook-order errors', async () => {
    // Phase 1: loading
    mockUseAuth.mockReturnValue({ user: null, loading: true, logout: vi.fn() });

    const { rerender } = renderAppLayout();

    // Loading spinner should be visible
    expect(screen.getByText(/loading/i)).toBeInTheDocument();
    // Sidebar should NOT be present yet
    expect(screen.queryByRole('link', { name: /account/i })).not.toBeInTheDocument();

    // Phase 2: auth resolved
    mockUseAuth.mockReturnValue({
      user: makeUser('student'),
      loading: false,
      logout: vi.fn(),
    });
    rerender(<AppLayoutWrapper />);

    // Sidebar should now be present
    await waitFor(() => {
      expect(screen.getByRole('link', { name: /account/i })).toBeInTheDocument();
    });
  });
});
```

Key implementation notes:

1. Look at how the existing AppLayout tests set up the render wrapper
   (they likely provide `MemoryRouter`, `QueryClientProvider`, and mock
   the `useAuth` module). Mirror that setup exactly.

2. The `useQuery` in AppLayout fires with `enabled: !loading && !!user`. In
   phase 2, it becomes enabled and attempts to fetch `/api/account`. The test
   fetch mock should return a 403 (or any non-crashing response) for this URL
   since we are only testing the nav render, not the account data. Returning
   `{ ok: false, status: 403 }` is sufficient — the query errors silently
   (retry is false in test QueryClient setup).

3. The test does NOT need to assert that no React warning was logged — the test
   will fail with an uncaught React error if the hook count changes, because
   React throws in development mode. The absence of a failure is the assertion.

4. If `AppLayout.test.tsx` already has a `renderAppLayout` helper function,
   use it. If not, create a minimal one following the pattern in
   `Account.test.tsx`.

### Files to Modify

- `tests/client/AppLayout.test.tsx` — add the new describe block.

### Files to Leave Unchanged

- `client/src/components/AppLayout.tsx` — no code changes; this ticket is
  tests only.

### Testing Plan

Run `npm run test:client` after adding the new test. The new describe block
should produce one passing test. All previously passing tests should remain
green.

If the test fails with a hook-order React error, that means the sprint 021
fix was reverted or was not correctly applied — the implementor should
investigate `AppLayout.tsx` to confirm `useQuery` appears before the
`if (loading)` early return.
