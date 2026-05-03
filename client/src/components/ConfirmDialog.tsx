import { useEffect } from 'react';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** When true, styles the Confirm button in a destructive red tone. */
  danger?: boolean;
}

export default function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  onConfirm,
  onCancel,
  danger = false,
}: ConfirmDialogProps) {
  // Close on ESC
  useEffect(() => {
    if (!open) return;
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') onCancel();
    }
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      style={overlayStyle}
      onClick={onCancel}
      aria-modal="true"
      role="dialog"
      aria-labelledby="confirm-dialog-title"
    >
      {/* Stop click events inside the dialog from propagating to the overlay */}
      <div style={panelStyle} onClick={(e) => e.stopPropagation()}>
        <h2 id="confirm-dialog-title" style={titleStyle}>
          {title}
        </h2>
        <p style={messageStyle}>{message}</p>
        <div style={buttonRowStyle}>
          <button type="button" onClick={onCancel} style={cancelBtnStyle}>
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            style={danger ? dangerBtnStyle : confirmBtnStyle}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles — consistent with Account.tsx / LlmProxyGrantModal palette
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
  maxWidth: 420,
  width: '90%',
};

const titleStyle: React.CSSProperties = {
  fontSize: '1rem',
  fontWeight: 600,
  color: '#1e293b',
  margin: '0 0 0.75rem 0',
};

const messageStyle: React.CSSProperties = {
  fontSize: '0.9rem',
  color: '#374151',
  lineHeight: 1.6,
  margin: '0 0 1.5rem 0',
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

const dangerBtnStyle: React.CSSProperties = {
  ...confirmBtnStyle,
  background: '#dc2626',
};
