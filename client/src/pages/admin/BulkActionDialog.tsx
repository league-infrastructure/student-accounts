/**
 * BulkActionDialog — modal dialog for cohort bulk-suspend and bulk-remove
 * operations (Sprint 008 T003).
 *
 * UI states:
 *  1. Fetching preview — spinner; Confirm disabled.
 *  2. Preview loaded   — count shown; Confirm enabled.
 *  3. Executing        — spinner; Confirm + Cancel disabled.
 *  4. Result panel     — succeeded count + failure list + Done button.
 *  5. Error state      — error message + Close button.
 */

import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type BulkAccountType = 'workspace' | 'claude';
export type BulkOperation = 'suspend' | 'remove';

export interface BulkAction {
  cohortId: number;
  cohortName: string;
  accountType: BulkAccountType;
  operation: BulkOperation;
}

interface BulkOperationFailure {
  accountId: number;
  userId: number;
  userName: string;
  error: string;
}

interface BulkOperationResult {
  succeeded: number[];
  failed: BulkOperationFailure[];
}

type DialogPhase = 'preview' | 'ready' | 'executing' | 'result' | 'error';

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchPreview(
  cohortId: number,
  accountType: BulkAccountType,
  operation: BulkOperation,
): Promise<number> {
  const params = new URLSearchParams({ accountType, operation });
  const res = await fetch(
    `/api/admin/cohorts/${cohortId}/bulk-preview?${params.toString()}`,
  );
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }
  return (body as { eligibleCount: number }).eligibleCount;
}

async function executeBulkOperation(
  cohortId: number,
  accountType: BulkAccountType,
  operation: BulkOperation,
): Promise<BulkOperationResult> {
  const endpoint = operation === 'suspend' ? 'bulk-suspend' : 'bulk-remove';
  const res = await fetch(`/api/admin/cohorts/${cohortId}/${endpoint}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountType }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && res.status !== 207) {
    throw new Error(
      (body as { error?: string }).error ?? `HTTP ${res.status}`,
    );
  }
  return body as BulkOperationResult;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function accountTypeLabel(accountType: BulkAccountType): string {
  return accountType === 'workspace' ? 'Workspace' : 'Claude';
}

function operationLabel(operation: BulkOperation): string {
  return operation === 'suspend' ? 'Suspend' : 'Remove';
}

// ---------------------------------------------------------------------------
// BulkActionDialog component
// ---------------------------------------------------------------------------

interface BulkActionDialogProps {
  action: BulkAction;
  onClose: () => void;
}

export function BulkActionDialog({ action, onClose }: BulkActionDialogProps) {
  const queryClient = useQueryClient();

  const [phase, setPhase] = useState<DialogPhase>('preview');
  const [eligibleCount, setEligibleCount] = useState<number | null>(null);
  const [result, setResult] = useState<BulkOperationResult | null>(null);
  const [errorMessage, setErrorMessage] = useState<string>('');

  const { cohortId, cohortName, accountType, operation } = action;
  const typeLabel = accountTypeLabel(accountType);
  const opLabel = operationLabel(operation);

  // Fetch preview when dialog opens
  useEffect(() => {
    let cancelled = false;
    setPhase('preview');
    setEligibleCount(null);
    setResult(null);
    setErrorMessage('');

    fetchPreview(cohortId, accountType, operation)
      .then((count) => {
        if (cancelled) return;
        setEligibleCount(count);
        setPhase('ready');
      })
      .catch((err: Error) => {
        if (cancelled) return;
        setErrorMessage(err.message);
        setPhase('error');
      });

    return () => {
      cancelled = true;
    };
  }, [cohortId, accountType, operation]);

  async function handleConfirm() {
    setPhase('executing');
    try {
      const res = await executeBulkOperation(cohortId, accountType, operation);
      setResult(res);
      setPhase('result');
    } catch (err: any) {
      setErrorMessage(err.message ?? 'Operation failed');
      setPhase('error');
    }
  }

  function handleDone() {
    queryClient.invalidateQueries({ queryKey: ['admin', 'cohorts'] });
    onClose();
  }

  // -------------------------------------------------------------------------
  // Overlay + dialog shell
  // -------------------------------------------------------------------------

  return (
    <div
      style={overlayStyle}
      role="dialog"
      aria-modal="true"
      aria-label={`${opLabel} ${typeLabel} accounts for ${cohortName}`}
    >
      <div style={dialogStyle}>
        <h3 style={dialogTitleStyle}>
          {opLabel} {typeLabel} Accounts — {cohortName}
        </h3>

        {/* ---------------------------------------------------------------- */}
        {/* Preview fetching                                                  */}
        {/* ---------------------------------------------------------------- */}
        {phase === 'preview' && (
          <div style={bodyStyle}>
            <p style={mutedTextStyle} aria-live="polite">
              Loading preview...
            </p>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Ready to confirm                                                  */}
        {/* ---------------------------------------------------------------- */}
        {phase === 'ready' && eligibleCount !== null && (
          <div style={bodyStyle}>
            <p style={confirmTextStyle}>
              {operation === 'suspend'
                ? `Suspend ${eligibleCount} ${typeLabel} account${eligibleCount !== 1 ? 's' : ''} for cohort ${cohortName}? Active accounts will be suspended. This can be reversed by re-provisioning individual accounts.`
                : `Remove ${eligibleCount} ${typeLabel} account${eligibleCount !== 1 ? 's' : ''} for cohort ${cohortName}? Workspace accounts will be suspended immediately and permanently deleted after 3 days. Claude seats are released immediately. This action cannot be undone.`}
            </p>

            {operation === 'remove' && (
              <p style={warningTextStyle} role="note">
                Workspace accounts will be deleted after 3 days. This action cannot be undone.
              </p>
            )}

            <div style={buttonRowStyle}>
              <button
                style={confirmButtonStyle(operation)}
                onClick={handleConfirm}
                aria-label={`Confirm ${opLabel.toLowerCase()} ${eligibleCount} ${typeLabel} accounts`}
              >
                Confirm {opLabel}
              </button>
              <button style={cancelButtonStyle} onClick={onClose}>
                Cancel
              </button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Executing                                                         */}
        {/* ---------------------------------------------------------------- */}
        {phase === 'executing' && (
          <div style={bodyStyle}>
            <p style={mutedTextStyle} aria-live="polite">
              Processing... please wait.
            </p>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Result panel                                                      */}
        {/* ---------------------------------------------------------------- */}
        {phase === 'result' && result !== null && (
          <div style={bodyStyle}>
            <p style={successTextStyle} aria-live="polite">
              {opLabel} complete. {result.succeeded.length} account
              {result.succeeded.length !== 1 ? 's' : ''} succeeded.
            </p>

            {result.failed.length > 0 && (
              <div style={failureBoxStyle}>
                <p style={failureTitleStyle}>
                  {result.failed.length} account
                  {result.failed.length !== 1 ? 's' : ''} failed:
                </p>
                <ul style={failureListStyle}>
                  {result.failed.map((f) => (
                    <li key={f.accountId} style={failureItemStyle}>
                      <strong>{f.userName}</strong>: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div style={buttonRowStyle}>
              <button style={doneButtonStyle} onClick={handleDone}>
                Done
              </button>
            </div>
          </div>
        )}

        {/* ---------------------------------------------------------------- */}
        {/* Error                                                             */}
        {/* ---------------------------------------------------------------- */}
        {phase === 'error' && (
          <div style={bodyStyle}>
            <p style={errorTextStyle} role="alert">
              {errorMessage}
            </p>
            <div style={buttonRowStyle}>
              <button style={cancelButtonStyle} onClick={onClose}>
                Close
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0, 0, 0, 0.45)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 1000,
};

const dialogStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  boxShadow: '0 4px 24px rgba(0,0,0,0.18)',
  padding: '24px 28px',
  maxWidth: 520,
  width: '90%',
};

const dialogTitleStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 16,
  fontWeight: 700,
  color: '#1e293b',
};

const bodyStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: 12,
};

const mutedTextStyle: React.CSSProperties = {
  color: '#64748b',
  fontSize: 14,
};

const confirmTextStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#1e293b',
  lineHeight: 1.5,
  margin: 0,
};

const warningTextStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#b45309',
  background: '#fffbeb',
  border: '1px solid #fde68a',
  borderRadius: 4,
  padding: '8px 12px',
  margin: 0,
};

const buttonRowStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  marginTop: 4,
};

function confirmButtonStyle(operation: BulkOperation): React.CSSProperties {
  return {
    padding: '7px 16px',
    fontSize: 13,
    fontWeight: 700,
    background: operation === 'suspend' ? '#f59e0b' : '#dc2626',
    color: '#fff',
    border: 'none',
    borderRadius: 4,
    cursor: 'pointer',
  };
}

const cancelButtonStyle: React.CSSProperties = {
  padding: '7px 16px',
  fontSize: 13,
  fontWeight: 600,
  background: '#94a3b8',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};

const successTextStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#166534',
  margin: 0,
};

const errorTextStyle: React.CSSProperties = {
  fontSize: 14,
  color: '#dc2626',
  margin: 0,
};

const failureBoxStyle: React.CSSProperties = {
  background: '#fef2f2',
  border: '1px solid #fca5a5',
  borderRadius: 4,
  padding: '10px 14px',
};

const failureTitleStyle: React.CSSProperties = {
  margin: '0 0 6px',
  fontSize: 13,
  fontWeight: 600,
  color: '#dc2626',
};

const failureListStyle: React.CSSProperties = {
  margin: 0,
  paddingLeft: 18,
};

const failureItemStyle: React.CSSProperties = {
  fontSize: 13,
  color: '#7f1d1d',
  marginBottom: 2,
};

const doneButtonStyle: React.CSSProperties = {
  padding: '7px 16px',
  fontSize: 13,
  fontWeight: 700,
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
};
