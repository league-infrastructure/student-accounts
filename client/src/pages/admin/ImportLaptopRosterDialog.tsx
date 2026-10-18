/**
 * ImportLaptopRosterDialog — admin dialog for the one-time laptop roster
 * import (sprint 002 "laptop accounts" T003).
 *
 * Asks for the group name (prefilled "Botball 26"), explains what the import
 * does, and POSTs /api/admin/import/laptop-roster. Shows the report:
 * counts, a collapsible per-entry details list, and a link to the merge
 * queue when anything was created (new users may duplicate Google/GitHub
 * accounts; the merge scan queues the likely pairs).
 */

import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';

export const DEFAULT_IMPORT_GROUP_NAME = 'Botball 26';

export interface ImportDetail {
  id: string;
  outcome: 'created' | 'matched' | 'skipped' | 'error';
  reason?: string;
}

export interface ImportReport {
  created: number;
  matched: number;
  skipped: number;
  errors: number;
  details: ImportDetail[];
}

export interface ImportLaptopRosterDialogProps {
  open: boolean;
  onClose: () => void;
  /** Called with the report after a successful run (e.g. to refetch users). */
  onImported?: (report: ImportReport) => void;
}

async function runImport(groupName: string): Promise<ImportReport> {
  const res = await fetch('/api/admin/import/laptop-roster', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ groupName }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

export default function ImportLaptopRosterDialog({
  open,
  onClose,
  onImported,
}: ImportLaptopRosterDialogProps) {
  const [groupName, setGroupName] = useState(DEFAULT_IMPORT_GROUP_NAME);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  // Reset on each open so a second use starts fresh.
  useEffect(() => {
    if (open) {
      setGroupName(DEFAULT_IMPORT_GROUP_NAME);
      setRunning(false);
      setError(null);
      setReport(null);
    }
  }, [open]);

  // Close on ESC (not while running).
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape' && !running) onClose();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, running, onClose]);

  if (!open) return null;

  async function handleRun() {
    const name = groupName.trim();
    if (!name) {
      setError('Group name must not be blank.');
      return;
    }
    setRunning(true);
    setError(null);
    try {
      const result = await runImport(name);
      setReport(result);
      onImported?.(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setRunning(false);
    }
  }

  return (
    <div
      style={overlayStyle}
      onClick={() => !running && onClose()}
      aria-modal="true"
      role="dialog"
      aria-labelledby="import-laptop-roster-title"
    >
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <h2 id="import-laptop-roster-title" style={titleStyle}>
          Import laptop roster
        </h2>

        {!report ? (
          <>
            <p style={textStyle}>
              Creates an account here for every student in the laptop roster
              (the Spaces bucket the laptops use), with their laptop username and
              password, and adds them to the group below. Students who already
              have an account with that username are left alone, so running this
              again is safe. New accounts are checked for duplicates of existing
              Google or GitHub accounts; likely matches appear in the merge queue.
            </p>

            <label style={labelStyle} htmlFor="import-laptop-roster-group">
              Group name
            </label>
            <input
              id="import-laptop-roster-group"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              disabled={running}
              style={inputStyle}
            />

            {error && (
              <div role="alert" style={errorStyle}>
                {error}
              </div>
            )}

            <div style={buttonRowStyle}>
              <button type="button" onClick={onClose} disabled={running} style={cancelBtnStyle}>
                Cancel
              </button>
              <button
                type="button"
                onClick={() => void handleRun()}
                disabled={running}
                style={confirmBtnStyle}
              >
                {running ? 'Importing…' : 'Run'}
              </button>
            </div>
          </>
        ) : (
          <>
            <p style={textStyle}>
              Imported into <strong>{groupName.trim()}</strong>.
            </p>
            <dl style={countsStyle} aria-label="Import counts">
              <dt>Created</dt>
              <dd data-testid="import-created">{report.created}</dd>
              <dt>Matched</dt>
              <dd data-testid="import-matched">{report.matched}</dd>
              <dt>Skipped</dt>
              <dd data-testid="import-skipped">{report.skipped}</dd>
              <dt>Errors</dt>
              <dd data-testid="import-errors" style={report.errors > 0 ? { color: '#dc2626' } : undefined}>
                {report.errors}
              </dd>
            </dl>

            {report.created > 0 && (
              <p style={textStyle}>
                New accounts may duplicate existing Google or GitHub users.{' '}
                <Link to="/merge-queue">Review the merge queue</Link>.
              </p>
            )}

            {report.details.length > 0 && (
              <details style={detailsStyle}>
                <summary style={summaryStyle}>Details ({report.details.length})</summary>
                <ul style={detailListStyle}>
                  {report.details.map((d) => (
                    <li key={d.id} style={detailItemStyle}>
                      <code>{d.id}</code> — {d.outcome}
                      {d.reason ? `: ${d.reason}` : ''}
                    </li>
                  ))}
                </ul>
              </details>
            )}

            <div style={buttonRowStyle}>
              <button type="button" onClick={onClose} style={confirmBtnStyle}>
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — consistent with ConfirmDialog
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const panelStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  padding: '1.75rem',
  boxShadow: '0 10px 25px rgba(0,0,0,0.15)',
  maxWidth: 480,
  width: '90%',
  maxHeight: '85vh',
  overflowY: 'auto',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 600,
  color: '#1e293b',
  margin: '0 0 0.75rem 0',
};

const textStyle: React.CSSProperties = {
  fontSize: '0.9rem',
  color: '#374151',
  lineHeight: 1.6,
  margin: '0 0 1rem 0',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  fontSize: '0.8rem',
  fontWeight: 600,
  color: '#374151',
  marginBottom: 4,
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  padding: '7px 10px',
  fontSize: '0.9rem',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  marginBottom: '1rem',
};

const errorStyle: React.CSSProperties = {
  background: '#fef2f2',
  border: '1px solid #fecaca',
  color: '#7f1d1d',
  borderRadius: 6,
  padding: '8px 12px',
  fontSize: '0.85rem',
  marginBottom: '1rem',
};

const countsStyle: React.CSSProperties = {
  display: 'grid',
  gridTemplateColumns: 'auto 1fr',
  columnGap: 16,
  rowGap: 4,
  fontSize: '0.9rem',
  color: '#1e293b',
  margin: '0 0 1rem 0',
};

const detailsStyle: React.CSSProperties = {
  fontSize: '0.85rem',
  color: '#374151',
  marginBottom: '1rem',
};

const summaryStyle: React.CSSProperties = {
  cursor: 'pointer',
  fontWeight: 600,
};

const detailListStyle: React.CSSProperties = {
  margin: '0.5rem 0 0 0',
  paddingLeft: '1.25rem',
  maxHeight: 240,
  overflowY: 'auto',
};

const detailItemStyle: React.CSSProperties = {
  marginBottom: 2,
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  justifyContent: 'flex-end',
};

const cancelBtnStyle: React.CSSProperties = {
  padding: '7px 16px',
  fontSize: '0.85rem',
  fontWeight: 500,
  borderRadius: 6,
  border: '1px solid #e2e8f0',
  background: '#f8fafc',
  color: '#374151',
  cursor: 'pointer',
};

const confirmBtnStyle: React.CSSProperties = {
  padding: '7px 16px',
  fontSize: '0.85rem',
  fontWeight: 600,
  borderRadius: 6,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
};
