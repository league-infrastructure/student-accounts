/**
 * SyncPanel — admin page for triggering sync operations.
 *
 * Two sections:
 *  1. Pike13 Sync  — POST /api/admin/sync/pike13
 *  2. Google Workspace Sync — four buttons for cohorts, staff, students, all
 *
 * Each button is disabled while any sync is in-flight. Results are displayed
 * per-section after completion. Errors are shown in a banner per section.
 */

import { useState } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SyncReport {
  created: number;
  matched: number;
  skipped: number;
  errors: number;
  errorDetails: string[];
}

interface WorkspaceSyncReport {
  cohortsUpserted?: number;
  staffUpserted?: number;
  studentsUpserted?: number;
  flaggedAccounts?: string[];
  errors?: Array<{ operation: string; error: string }>;
}

// ---------------------------------------------------------------------------
// Spinner — injects a keyframe rule once and renders a spinning element
// ---------------------------------------------------------------------------

let spinnerStyleInjected = false;

function Spinner() {
  if (!spinnerStyleInjected && typeof document !== 'undefined') {
    const style = document.createElement('style');
    style.textContent = '@keyframes sp-rotate { to { transform: rotate(360deg); } }';
    document.head.appendChild(style);
    spinnerStyleInjected = true;
  }
  return (
    <span
      role="status"
      aria-label="Loading"
      style={spinnerStyle}
    />
  );
}

// ---------------------------------------------------------------------------
// SyncPanel component
// ---------------------------------------------------------------------------

export default function SyncPanel() {
  const [anyLoading, setAnyLoading] = useState(false);

  // Pike13 state
  const [pike13Loading, setPike13Loading] = useState(false);
  const [pike13Result, setPike13Result] = useState<SyncReport | null>(null);
  const [pike13Error, setPike13Error] = useState<string | null>(null);

  // Workspace state
  const [wsLoading, setWsLoading] = useState<string | null>(null); // which op is loading
  const [wsResult, setWsResult] = useState<WorkspaceSyncReport | null>(null);
  const [wsError, setWsError] = useState<string | null>(null);

  // -------------------------------------------------------------------------
  // Pike13 handlers
  // -------------------------------------------------------------------------

  async function handlePike13Sync() {
    setPike13Loading(true);
    setAnyLoading(true);
    setPike13Result(null);
    setPike13Error(null);
    try {
      const res = await fetch('/api/admin/sync/pike13', {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data: SyncReport = await res.json();
      setPike13Result(data);
    } catch (err) {
      setPike13Error(err instanceof Error ? err.message : String(err));
    } finally {
      setPike13Loading(false);
      setAnyLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Workspace handlers
  // -------------------------------------------------------------------------

  async function handleWorkspaceSync(
    op: string,
    endpoint: string,
  ) {
    setWsLoading(op);
    setAnyLoading(true);
    setWsResult(null);
    setWsError(null);
    try {
      const res = await fetch(endpoint, {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const data: WorkspaceSyncReport = await res.json();
      setWsResult(data);
    } catch (err) {
      setWsError(err instanceof Error ? err.message : String(err));
    } finally {
      setWsLoading(null);
      setAnyLoading(false);
    }
  }

  // -------------------------------------------------------------------------
  // Render helpers
  // -------------------------------------------------------------------------

  function renderPike13Result(report: SyncReport) {
    return (
      <div style={resultPanelStyle} role="region" aria-label="Pike13 sync result">
        <div style={countRowStyle}>
          <CountBadge label="Created" value={report.created} color="#16a34a" />
          <CountBadge label="Matched" value={report.matched} color="#2563eb" />
          <CountBadge label="Skipped" value={report.skipped} color="#64748b" />
          <CountBadge label="Errors" value={report.errors} color={report.errors > 0 ? '#dc2626' : '#64748b'} />
        </div>
        {report.errorDetails && report.errorDetails.length > 0 && (
          <div style={errorDetailsStyle}>
            <strong style={{ fontSize: 13 }}>Error details:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {report.errorDetails.map((d, i) => (
                <li key={i} style={{ fontSize: 13 }}>{d}</li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  function renderWorkspaceResult(report: WorkspaceSyncReport) {
    const hasCounts =
      report.cohortsUpserted !== undefined ||
      report.staffUpserted !== undefined ||
      report.studentsUpserted !== undefined;

    return (
      <div style={resultPanelStyle} role="region" aria-label="Workspace sync result">
        {hasCounts && (
          <div style={countRowStyle}>
            {report.cohortsUpserted !== undefined && (
              <CountBadge label="Cohorts Upserted" value={report.cohortsUpserted} color="#2563eb" />
            )}
            {report.staffUpserted !== undefined && (
              <CountBadge label="Staff Upserted" value={report.staffUpserted} color="#2563eb" />
            )}
            {report.studentsUpserted !== undefined && (
              <CountBadge label="Students Upserted" value={report.studentsUpserted} color="#2563eb" />
            )}
            {report.flaggedAccounts !== undefined && (
              <CountBadge
                label="Flagged"
                value={report.flaggedAccounts.length}
                color={report.flaggedAccounts.length > 0 ? '#d97706' : '#64748b'}
              />
            )}
          </div>
        )}

        {report.flaggedAccounts && report.flaggedAccounts.length > 0 && (
          <div style={{ marginTop: 12 }}>
            <strong style={{ fontSize: 13, color: '#92400e' }}>
              Flagged accounts (removed from Workspace):
            </strong>
            <table style={{ ...tableStyle, marginTop: 6 }}>
              <thead>
                <tr>
                  <th style={thStyle}>Email</th>
                </tr>
              </thead>
              <tbody>
                {report.flaggedAccounts.map((email) => (
                  <tr key={email}>
                    <td style={tdStyle}>{email}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {report.errors && report.errors.length > 0 && (
          <div style={{ marginTop: 10 }}>
            <strong style={{ fontSize: 13, color: '#dc2626' }}>Sub-operation errors:</strong>
            <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
              {report.errors.map((e, i) => (
                <li key={i} style={{ fontSize: 13 }}>
                  <span style={{ fontWeight: 600 }}>{e.operation}:</span> {e.error}
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    );
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <div>
      <h2 style={headingStyle}>Sync</h2>

      {/* ------------------------------------------------------------------ */}
      {/* Pike13 Sync section                                                */}
      {/* ------------------------------------------------------------------ */}

      <section style={sectionStyle} aria-labelledby="pike13-section-heading">
        <h3 id="pike13-section-heading" style={subheadingStyle}>Pike13 Sync</h3>
        <p style={descStyle}>
          Fetch all people from Pike13 and upsert matching User records.
        </p>

        <div style={buttonRowStyle}>
          <button
            style={primaryButtonStyle(anyLoading)}
            disabled={anyLoading}
            onClick={() => void handlePike13Sync()}
          >
            {pike13Loading ? <><Spinner /> Syncing Pike13...</> : 'Sync Pike13 People'}
          </button>
        </div>

        {pike13Error && (
          <div style={errorBannerStyle} role="alert">
            {pike13Error}
          </div>
        )}

        {pike13Result && renderPike13Result(pike13Result)}
      </section>

      {/* ------------------------------------------------------------------ */}
      {/* Google Workspace Sync section                                       */}
      {/* ------------------------------------------------------------------ */}

      <section style={sectionStyle} aria-labelledby="ws-section-heading">
        <h3 id="ws-section-heading" style={subheadingStyle}>Google Workspace Sync</h3>
        <p style={descStyle}>
          Import cohorts, staff, and students from Google Workspace into the
          local database.
        </p>

        <div style={buttonRowStyle}>
          <button
            style={secondaryButtonStyle(anyLoading)}
            disabled={anyLoading}
            onClick={() => void handleWorkspaceSync('cohorts', '/api/admin/sync/workspace/cohorts')}
          >
            {wsLoading === 'cohorts' ? <><Spinner /> Syncing...</> : 'Sync Cohorts'}
          </button>
          <button
            style={secondaryButtonStyle(anyLoading)}
            disabled={anyLoading}
            onClick={() => void handleWorkspaceSync('staff', '/api/admin/sync/workspace/staff')}
          >
            {wsLoading === 'staff' ? <><Spinner /> Syncing...</> : 'Sync Staff'}
          </button>
          <button
            style={secondaryButtonStyle(anyLoading)}
            disabled={anyLoading}
            onClick={() => void handleWorkspaceSync('students', '/api/admin/sync/workspace/students')}
          >
            {wsLoading === 'students' ? <><Spinner /> Syncing...</> : 'Sync Students'}
          </button>
          <button
            style={primaryButtonStyle(anyLoading)}
            disabled={anyLoading}
            onClick={() => void handleWorkspaceSync('all', '/api/admin/sync/workspace/all')}
          >
            {wsLoading === 'all' ? <><Spinner /> Syncing...</> : 'Sync All Workspace'}
          </button>
        </div>

        {wsError && (
          <div style={errorBannerStyle} role="alert">
            {wsError}
          </div>
        )}

        {wsResult && renderWorkspaceResult(wsResult)}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CountBadge helper
// ---------------------------------------------------------------------------

function CountBadge({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div style={countBadgeStyle}>
      <span style={{ fontSize: 22, fontWeight: 700, color }}>{value}</span>
      <span style={{ fontSize: 12, color: '#64748b', marginTop: 2 }}>{label}</span>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headingStyle: React.CSSProperties = {
  margin: '0 0 24px',
  fontSize: 20,
};

const subheadingStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 16,
  fontWeight: 600,
};

const descStyle: React.CSSProperties = {
  margin: '0 0 14px',
  fontSize: 14,
  color: '#64748b',
};

const sectionStyle: React.CSSProperties = {
  marginBottom: 32,
  padding: 20,
  border: '1px solid #e2e8f0',
  borderRadius: 8,
  background: '#fafafa',
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 10,
  flexWrap: 'wrap',
  alignItems: 'center',
};

function primaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 16px',
    fontSize: 14,
    background: disabled ? '#a5b4fc' : '#4f46e5',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 600,
  };
}

function secondaryButtonStyle(disabled: boolean): React.CSSProperties {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 14px',
    fontSize: 14,
    background: disabled ? '#f1f5f9' : '#fff',
    color: disabled ? '#94a3b8' : '#334155',
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontWeight: 500,
  };
}

const errorBannerStyle: React.CSSProperties = {
  marginTop: 12,
  padding: '8px 12px',
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: 4,
  color: '#dc2626',
  fontSize: 13,
};

const resultPanelStyle: React.CSSProperties = {
  marginTop: 14,
  padding: '12px 14px',
  background: '#f0fdf4',
  border: '1px solid #bbf7d0',
  borderRadius: 4,
};

const countRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 20,
  flexWrap: 'wrap',
};

const countBadgeStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  minWidth: 60,
};

const errorDetailsStyle: React.CSSProperties = {
  marginTop: 10,
  padding: '8px 10px',
  background: '#fff7ed',
  border: '1px solid #fed7aa',
  borderRadius: 4,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 13,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '6px 10px',
  borderBottom: '2px solid #e2e8f0',
  fontWeight: 600,
  fontSize: 12,
  color: '#64748b',
};

const tdStyle: React.CSSProperties = {
  padding: '6px 10px',
  borderBottom: '1px solid #f1f5f9',
};

const spinnerStyle: React.CSSProperties = {
  display: 'inline-block',
  width: 12,
  height: 12,
  border: '2px solid rgba(255,255,255,0.4)',
  borderTopColor: '#fff',
  borderRadius: '50%',
  animation: 'sp-rotate 0.7s linear infinite',
};
