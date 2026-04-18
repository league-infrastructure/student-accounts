---
id: '015'
title: Add Sign-in methods section to Account page
status: done
use-cases:
- SUC-011
- SUC-012
depends-on:
- '011'
- '012'
- '013'
- '014'
github-issue: ''
todo: plan-social-login-account-linking-for-the-template-demo.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# 015 — Add Sign-in methods section to Account page

## Description

`client/src/pages/Account.tsx` currently shows a read-only profile card. This ticket
appends a "Sign-in methods" section below the existing card. The section shows:

1. Each provider already linked to the current user (from `user.linkedProviders`), with an
   "Unlink" button (disabled when it is the user's only remaining method).
2. For each configured-but-not-yet-linked provider (from `useProviderStatus()`), an
   "Add \<Provider\>" button that navigates to `/api/auth/<provider>?link=1`.

This is the final ticket in the social-login group. It depends on all three backend tickets
(011, 012, 013) and the login-page ticket (014) for the shared `useProviderStatus` hook.

## Acceptance Criteria

- [x] "Sign-in methods" card section is visible below the existing account info card
- [x] Each entry in `user.linkedProviders` is displayed with the provider name and an "Unlink" button
- [x] "Unlink" button is disabled when `user.linkedProviders.length === 1` (only one method remaining)
- [x] Clicking an active "Unlink" button calls `POST /api/auth/unlink/:provider` and, on success, calls `refresh()` to reload user state
- [x] On unlink error, an error message is displayed near the button
- [x] For each provider returned by `useProviderStatus()` that is NOT in `user.linkedProviders`, an "Add \<Provider\>" button is shown
- [x] "Add \<Provider\>" button navigates to `/api/auth/<provider>?link=1` (browser redirect)
- [x] When no providers are configured, the "Add" section is empty (no orphan headings)
- [x] The section uses per-provider brand colors consistent with Login.tsx (GitHub `#24292e`, Google white/border, Pike 13 `#f37121`)
- [x] Existing account info card (avatar, name, email, role, provider, member since) is unchanged

## Files to Modify

- `client/src/pages/Account.tsx` — append "Sign-in methods" section

## Files to Read

- `client/src/hooks/useProviderStatus.ts` — created in ticket 014; import and use here
- `client/src/context/AuthContext.tsx` — `refresh()` function for post-unlink state update

## Implementation Plan

### Section layout

Append below the existing card (or as a second card in the same container):

```tsx
<div style={styles.card}>
  <h2 style={styles.sectionTitle}>Sign-in methods</h2>

  {/* Linked providers */}
  {(user.linkedProviders ?? []).length === 0 && (
    <p style={styles.empty}>No OAuth providers linked.</p>
  )}
  {(user.linkedProviders ?? []).map(provider => (
    <div key={provider} style={styles.providerRow}>
      <span style={styles.providerName}>{providerLabel(provider)}</span>
      <button
        onClick={() => handleUnlink(provider)}
        disabled={(user.linkedProviders?.length ?? 0) <= 1 || unlinking === provider}
        style={unlinkButtonStyle(provider)}
      >
        {unlinking === provider ? 'Unlinking…' : 'Unlink'}
      </button>
    </div>
  ))}

  {/* Addable providers */}
  {(configurableButUnlinked.length > 0) && (
    <div style={styles.addRow}>
      {configurableButUnlinked.map(provider => (
        <a
          key={provider}
          href={`/api/auth/${provider}?link=1`}
          style={addButtonStyle(provider)}
        >
          Add {providerLabel(provider)}
        </a>
      ))}
    </div>
  )}

  {unlinkError && <p style={styles.error}>{unlinkError}</p>}
</div>
```

### `handleUnlink`

```typescript
async function handleUnlink(provider: string) {
  setUnlinking(provider);
  setUnlinkError(null);
  try {
    const res = await fetch(`/api/auth/unlink/${provider}`, { method: 'POST' });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setUnlinkError((body as any).error ?? 'Failed to unlink provider');
    } else {
      await refresh(); // reload user from /api/auth/me
    }
  } catch {
    setUnlinkError('Network error');
  } finally {
    setUnlinking(null);
  }
}
```

### Helper functions

```typescript
// Derive configured-but-unlinked list
const linked = new Set(user.linkedProviders ?? []);
const configurableButUnlinked = (
  Object.entries(providerStatus) as [string, boolean][]
)
  .filter(([k, v]) => k !== 'loading' && v && !linked.has(k))
  .map(([k]) => k);

// Display name per provider
function providerLabel(p: string): string {
  return { github: 'GitHub', google: 'Google', pike13: 'Pike 13' }[p] ?? p;
}
```

### State

```typescript
const { user, refresh } = useAuth();
const providerStatus = useProviderStatus();
const [unlinking, setUnlinking] = useState<string | null>(null);
const [unlinkError, setUnlinkError] = useState<string | null>(null);
```

### Styling

Keep the existing inline-style pattern from Account.tsx. Add new style entries:

```typescript
sectionTitle: { fontSize: '1rem', fontWeight: 600, color: '#1e293b', marginBottom: '1rem' },
providerRow: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' },
providerName: { fontSize: '0.9rem', color: '#1e293b', textTransform: 'capitalize' as const },
addRow: { display: 'flex', gap: '0.5rem', marginTop: '1rem', flexWrap: 'wrap' as const },
empty: { fontSize: '0.85rem', color: '#64748b' },
error: { fontSize: '0.85rem', color: '#dc2626', marginTop: '0.5rem' },
```

### Testing Plan

Manual smoke tests:
1. Log in as `user`/`pass` — confirm "Sign-in methods" section visible with empty list
   and no "Add" buttons when no providers configured
2. Log in with GitHub OAuth → visit Account — confirm "GitHub" listed, "Unlink" present
3. Click "Unlink" when it's the only method → confirm button is disabled
4. Link a second provider, then unlink one → confirm list updates without page reload

## Testing

- **Existing tests to run**: `cd server && npm test` — backend regression check
- **New tests to write**: No automated frontend tests required by sprint strategy; manual smoke tests above
- **Verification command**: Manual smoke test; `cd server && npm test`
