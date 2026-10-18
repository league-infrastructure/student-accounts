/**
 * MergeWithDialog — "Merge with…" button plus the dialog behind it (sprint
 * 002 "laptop accounts" T008, SUC-005).
 *
 * Lets an admin merge the user on the detail panel with any other active
 * user: search the admin users list (GET /api/admin/users, filtered
 * client-side by name, email or login username), pick the other user, pick
 * which of the two survives, confirm. POST /api/admin/users/:id/merge
 * { otherUserId, survivorId } records an admin-initiated suggestion and
 * approves it in one request; on success `onMerged(survivorId)` fires so the
 * panel can move to the surviving user.
 */

import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../context/ToastContext';

// ---------------------------------------------------------------------------
// Types (subset of the admin users list payload)
// ---------------------------------------------------------------------------

export interface MergeCandidate {
  id: number;
  email: string;
  displayName: string | null;
  role: string;
  providers?: Array<{ provider: string; username?: string | null; email?: string | null }>;
}

interface Props {
  userId: number;
  userName: string;
  onMerged: (survivorId: number) => void;
}

/** Candidates matching `query` (name, email, login username/email), excluding `selfId`. */
export function filterCandidates(
  candidates: MergeCandidate[],
  selfId: number,
  query: string,
  limit = 20,
): MergeCandidate[] {
  const q = query.trim().toLowerCase();
  const out: MergeCandidate[] = [];
  for (const c of candidates) {
    if (c.id === selfId) continue;
    if (q) {
      const haystack = [
        c.displayName ?? '',
        c.email,
        ...(c.providers ?? []).flatMap((p) => [p.username ?? '', p.email ?? '']),
      ]
        .join(' ')
        .toLowerCase();
      if (!haystack.includes(q)) continue;
    }
    out.push(c);
    if (out.length >= limit) break;
  }
  return out;
}

function labelFor(c: MergeCandidate): string {
  return c.displayName ? `${c.displayName} <${c.email}>` : c.email;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function MergeWithDialog({ userId, userName, onMerged }: Props) {
  const { showToast } = useToast();
  const [open, setOpen] = useState(false);
  const [candidates, setCandidates] = useState<MergeCandidate[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [query, setQuery] = useState('');
  const [other, setOther] = useState<MergeCandidate | null>(null);
  const [survivor, setSurvivor] = useState<'this' | 'other'>('this');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open || candidates !== null) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch('/api/admin/users', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const list = (await res.json()) as MergeCandidate[];
        if (!cancelled) setCandidates(list);
      } catch (err: any) {
        if (!cancelled) setLoadError(err?.message ?? 'Could not load users');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, candidates]);

  const matches = useMemo(
    () => filterCandidates(candidates ?? [], userId, query),
    [candidates, userId, query],
  );

  function reset() {
    setOpen(false);
    setQuery('');
    setOther(null);
    setSurvivor('this');
    setError('');
    setBusy(false);
  }

  async function submit() {
    if (!other) return;
    const survivorId = survivor === 'this' ? userId : other.id;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`/api/admin/users/${userId}/merge`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ otherUserId: other.id, survivorId }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      showToast(
        `Merged ${survivor === 'this' ? labelFor(other) : userName} into ${
          survivor === 'this' ? userName : labelFor(other)
        }`,
        'success',
      );
      reset();
      onMerged((body as { survivorId?: number }).survivorId ?? survivorId);
    } catch (err: any) {
      const msg = err?.message ?? 'Merge failed';
      setError(msg);
      showToast(msg, 'error');
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        style={triggerStyle}
        onClick={() => setOpen(true)}
        aria-label="Merge with another user"
      >
        Merge with…
      </button>

      {open && (
        <div style={overlayStyle} role="dialog" aria-modal="true" aria-label="Merge with another user">
          <div style={dialogStyle}>
            <h3 style={{ margin: '0 0 6px', fontSize: 16, fontWeight: 700 }}>Merge {userName} with…</h3>
            <p style={hintStyle}>
              Pick the other account, then choose which one survives. Logins, external
              accounts, groups, proxy token and credentials move to the survivor; the other
              account is deactivated. This cannot be undone.
            </p>

            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search name, email or username…"
              aria-label="Search users to merge with"
              style={searchStyle}
              autoFocus
            />

            {loadError && <div style={errorStyle} role="alert">{loadError}</div>}
            {!loadError && candidates === null && <div style={hintStyle}>Loading users…</div>}
            {candidates !== null && (
              <ul style={listStyle} aria-label="Matching users">
                {matches.length === 0 && <li style={hintStyle}>No matching users.</li>}
                {matches.map((c) => (
                  <li key={c.id}>
                    <label style={candidateStyle(other?.id === c.id)}>
                      <input
                        type="radio"
                        name={`merge-other-${userId}`}
                        checked={other?.id === c.id}
                        onChange={() => setOther(c)}
                        aria-label={`Select ${c.email}`}
                      />
                      <span style={{ fontWeight: 600 }}>{c.displayName ?? c.email}</span>
                      <span style={{ color: '#64748b', fontSize: 12 }}>{c.email}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}

            {other && (
              <fieldset style={fieldsetStyle}>
                <legend style={{ fontSize: 13, fontWeight: 600, color: '#334155' }}>Survivor</legend>
                <label style={radioRowStyle}>
                  <input
                    type="radio"
                    name={`merge-survivor-${userId}`}
                    checked={survivor === 'this'}
                    onChange={() => setSurvivor('this')}
                    aria-label={`Keep ${userName}`}
                  />
                  Keep <strong>{userName}</strong> (this user); deactivate {labelFor(other)}
                </label>
                <label style={radioRowStyle}>
                  <input
                    type="radio"
                    name={`merge-survivor-${userId}`}
                    checked={survivor === 'other'}
                    onChange={() => setSurvivor('other')}
                    aria-label={`Keep ${other.email}`}
                  />
                  Keep <strong>{labelFor(other)}</strong>; deactivate {userName}
                </label>
              </fieldset>
            )}

            {error && <div style={errorStyle} role="alert">{error}</div>}

            <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 14 }}>
              <button type="button" style={cancelStyle} onClick={reset} disabled={busy}>
                Cancel
              </button>
              <button
                type="button"
                style={confirmStyle(busy || !other)}
                onClick={submit}
                disabled={busy || !other}
                aria-label="Confirm merge"
              >
                {busy ? 'Merging…' : 'Merge'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const triggerStyle: React.CSSProperties = {
  padding: '5px 12px',
  fontSize: 13,
  background: '#fff',
  color: '#334155',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 500,
};

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 300,
};

const dialogStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 10,
  padding: '22px 26px',
  maxWidth: 520,
  width: '92%',
  boxShadow: '0 8px 32px rgba(0,0,0,0.18)',
};

const hintStyle: React.CSSProperties = { fontSize: 13, color: '#64748b', margin: '0 0 12px' };

const searchStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 10px',
  fontSize: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  marginBottom: 10,
};

const listStyle: React.CSSProperties = {
  listStyle: 'none',
  margin: 0,
  padding: 0,
  maxHeight: 220,
  overflowY: 'auto',
  border: '1px solid #e2e8f0',
  borderRadius: 4,
};

function candidateStyle(selected: boolean): React.CSSProperties {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    fontSize: 13,
    cursor: 'pointer',
    background: selected ? '#f0f0ff' : 'transparent',
    borderBottom: '1px solid #f1f5f9',
  };
}

const fieldsetStyle: React.CSSProperties = {
  marginTop: 12,
  border: '1px solid #e2e8f0',
  borderRadius: 4,
  padding: '8px 12px',
};

const radioRowStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  fontSize: 13,
  color: '#334155',
  padding: '4px 0',
  cursor: 'pointer',
};

const errorStyle: React.CSSProperties = {
  marginTop: 10,
  padding: '8px 12px',
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: 4,
  color: '#dc2626',
  fontSize: 13,
};

const cancelStyle: React.CSSProperties = {
  padding: '7px 16px',
  fontSize: 14,
  background: '#fff',
  color: '#334155',
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 500,
};

function confirmStyle(disabled: boolean): React.CSSProperties {
  return {
    padding: '7px 16px',
    fontSize: 14,
    background: disabled ? '#fca5a5' : '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
  };
}
