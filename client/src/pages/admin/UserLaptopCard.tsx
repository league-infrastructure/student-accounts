/**
 * UserLaptopCard — admin view of one user's laptop login (sprint 002 "laptop
 * accounts" T006, SUC-007).
 *
 * Rendered inside UserDetailPanel with the same inline-style vocabulary as
 * the neighbouring cards. The laptop login is simply the account's username
 * and password (no separate switch, admins included). Shows the state line,
 * plus what an instructor can do about a failed sync:
 *
 *   - "Sync pending" indicator     — laptop_roster_dirty: the last roster
 *                                   write failed; the hourly job retries
 *   - "Push now"                   → POST /api/admin/users/:id/laptop/push
 *                                   (reconcile this one user; result toast).
 *                                   Shown only while laptop_roster_dirty: it
 *                                   is a repair action. Every change that
 *                                   affects the roster entry writes it at
 *                                   once, so a clean row has nothing to push.
 *
 * Data comes from GET /api/admin/users/:id under the same query key the
 * panel uses (['admin', 'users', id, 'detail']), so the card shares the
 * panel's cache and every action refreshes both with one invalidation.
 */

import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useToast } from '../../context/ToastContext';

export type LaptopLoginStateName =
  | 'ready'
  | 'disabled'
  | 'needs_password'
  | 'invalid_username';

/** The slice of GET /api/admin/users/:id this card reads. */
export interface LaptopDetail {
  id: number;
  role: string;
  username: string | null;
  laptop_roster_dirty: boolean;
  laptop_login_state: LaptopLoginStateName;
}

export type ReconcileOutcome = 'written' | 'locked' | 'unchanged' | 'skipped' | 'failed';

interface PushResult {
  outcome: ReconcileOutcome;
  laptopLogin: { state: LaptopLoginStateName; dirty: boolean; lastWritten?: string };
}

interface Props {
  userId: number;
  userName?: string;
}

/** One line per state, for an instructor. */
export function StateLine({ detail }: { detail: Pick<LaptopDetail, 'laptop_login_state' | 'username'> }) {
  switch (detail.laptop_login_state) {
    case 'ready':
      return (
        <>
          Logs in on League laptops as <strong>{detail.username}</strong> with the account password.
        </>
      );
    case 'needs_password':
      return <>Set a password (Credentials card above) to enable laptop login.</>;
    case 'invalid_username':
      return <>Username must be 3–32 lowercase letters, digits or dashes to work on laptops.</>;
    case 'disabled':
    default:
      return <>Account is deactivated; laptop login is locked.</>;
  }
}

/** Toast text for a push outcome. */
export function describeOutcome(outcome: ReconcileOutcome): string {
  switch (outcome) {
    case 'written':
      return 'Laptop login written to the roster.';
    case 'locked':
      return 'Roster entry locked.';
    case 'unchanged':
      return 'Roster already up to date.';
    case 'skipped':
      return 'Nothing to write for this user.';
    case 'failed':
    default:
      return 'Roster write failed; the hourly job will retry.';
  }
}

async function readError(res: Response): Promise<string> {
  const body = await res.json().catch(() => ({}));
  return (body as { error?: string }).error ?? `HTTP ${res.status}`;
}

export default function UserLaptopCard({ userId, userName }: Props) {
  const queryClient = useQueryClient();
  const { showToast } = useToast();

  const { data: detail, error: queryError } = useQuery<LaptopDetail>({
    queryKey: ['admin', 'users', userId, 'detail'],
    queryFn: async () => {
      const res = await fetch(`/api/admin/users/${userId}`);
      if (!res.ok) throw new Error(await readError(res));
      return res.json();
    },
    enabled: Number.isFinite(userId),
  });

  const refetch = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'detail'] }),
      queryClient.invalidateQueries({ queryKey: ['admin', 'users', userId, 'credentials'] }),
    ]);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run<T>(fn: () => Promise<T>): Promise<T | undefined> {
    setBusy(true);
    setError(null);
    try {
      return await fn();
    } catch (e: unknown) {
      const message = e instanceof Error ? e.message : 'Request failed';
      setError(message);
      showToast(message, 'error');
      return undefined;
    } finally {
      setBusy(false);
    }
  }

  async function pushNow() {
    const result = await run(async () => {
      const res = await fetch(`/api/admin/users/${userId}/laptop/push`, { method: 'POST' });
      if (!res.ok) throw new Error(await readError(res));
      return (await res.json()) as PushResult;
    });
    if (!result) return;
    showToast(describeOutcome(result.outcome), result.outcome === 'failed' ? 'error' : 'success');
    await refetch();
  }

  const name = userName ?? 'this user';
  const err = error ?? (queryError ? (queryError as Error).message : null);
  // A detail payload without the laptop fields (older server) renders the
  // title and nothing else rather than guessing.
  const ready = !!detail && typeof detail.laptop_login_state === 'string';

  return (
    <section data-testid="laptop-card" style={cardStyle}>
      <h2 style={cardTitleStyle}>Laptop login</h2>

      {err && (
        <div role="alert" style={errorStyle}>
          {err}
        </div>
      )}

      {ready && detail && (
        <>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: 8 }}>
            <StatePill state={detail.laptop_login_state} />
            {detail.laptop_roster_dirty && (
              <span
                data-testid="laptop-dirty"
                title="The last roster write failed; retried hourly, or push now."
                style={dirtyPillStyle}
              >
                Sync pending
              </span>
            )}
          </div>
          <p data-testid="laptop-state-line" style={stateLineStyle}>
            <StateLine detail={detail} />
          </p>

          {detail.laptop_roster_dirty && (
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => void pushNow()}
                disabled={busy}
                style={smallButtonStyle('primary', busy)}
                title={`Retry ${name}'s roster write now`}
              >
                {busy ? 'Working…' : 'Push now'}
              </button>
              <span style={hintStyle}>
                Retries the failed write of students/{detail.username ?? '<username>'}/config.json
                now instead of waiting for the hourly job.
              </span>
            </div>
          )}
        </>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Small presentational helpers
// ---------------------------------------------------------------------------

function StatePill({ state }: { state: LaptopLoginStateName }) {
  const c =
    state === 'ready'
      ? { bg: '#d1fae5', fg: '#065f46' }
      : state === 'needs_password' || state === 'invalid_username'
        ? { bg: '#fef3c7', fg: '#92400e' }
        : { bg: '#e2e8f0', fg: '#475569' };
  return (
    <span
      data-testid="laptop-state-pill"
      style={{ fontSize: 11, padding: '2px 8px', background: c.bg, color: c.fg, borderRadius: 999, fontWeight: 600 }}
    >
      {state.replace('_', ' ')}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Styles (mirrors UserCredentialsCard / UserDetailPanel)
// ---------------------------------------------------------------------------

function smallButtonStyle(variant: 'primary' | 'neutral', disabled = false): React.CSSProperties {
  const palette =
    variant === 'primary'
      ? { bg: '#2563eb', fg: '#fff', border: 'none' }
      : { bg: '#f1f5f9', fg: '#0f172a', border: '1px solid #cbd5e1' };
  return {
    padding: '7px 14px',
    background: palette.bg,
    color: palette.fg,
    border: palette.border,
    borderRadius: 6,
    fontWeight: 600,
    fontSize: 13,
    cursor: disabled ? 'not-allowed' : 'pointer',
    opacity: disabled ? 0.5 : 1,
  };
}

const cardStyle: React.CSSProperties = {
  background: '#fff',
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  padding: '16px 18px',
  marginBottom: 14,
  boxShadow: '0 1px 2px rgba(0,0,0,0.03)',
};

const cardTitleStyle: React.CSSProperties = {
  margin: '0 0 10px',
  fontSize: 14,
  fontWeight: 700,
  color: '#0f172a',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const errorStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#991b1b',
  background: '#fee2e2',
  border: '1px solid #fecaca',
  padding: '8px 10px',
  borderRadius: 6,
  marginBottom: 10,
};

const stateLineStyle: React.CSSProperties = { margin: '0 0 12px', fontSize: 13, color: '#0f172a' };

const dirtyPillStyle: React.CSSProperties = {
  fontSize: 11,
  padding: '2px 8px',
  background: '#fef3c7',
  color: '#92400e',
  border: '1px solid #fcd34d',
  borderRadius: 999,
  fontWeight: 600,
};

const hintStyle: React.CSSProperties = { fontSize: 12, color: '#94a3b8' };
