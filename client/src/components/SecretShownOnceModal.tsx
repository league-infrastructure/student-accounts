/**
 * SecretShownOnceModal — displays a freshly-minted secret exactly once.
 *
 * After create or rotate, the server returns a plaintext client_secret
 * that is never queryable again. This modal shows it with a Copy button
 * and a prominent "you will not see this again" warning.
 *
 * Used by the OAuth client admin UI (Sprint 018) and reusable for future
 * secrets (Sprint 019 etc.).
 */

import { useState } from 'react';

interface SecretShownOnceModalProps {
  /** Title displayed at the top of the modal. */
  title: string;
  /** The plaintext secret to display. */
  secret: string;
  /** Label describing what the secret is (e.g. "Client Secret"). */
  label?: string;
  /** Callback when the user clicks "Done" or closes the modal. */
  onClose: () => void;
}

export function SecretShownOnceModal({
  title,
  secret,
  label = 'Secret',
  onClose,
}: SecretShownOnceModalProps) {
  const [copied, setCopied] = useState(false);

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(secret);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback: select text manually
      const el = document.getElementById('secret-value') as HTMLTextAreaElement | null;
      el?.select();
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2 style={{ marginTop: 0, marginBottom: 12, fontSize: 18, color: '#0f172a' }}>
          {title}
        </h2>

        {/* Warning banner */}
        <div style={warningStyle}>
          This secret is shown <strong>once only</strong>. Copy it now — you will not
          be able to view it again after closing this dialog.
        </div>

        <label style={labelStyle}>{label}</label>
        <div style={{ position: 'relative', marginBottom: 20 }}>
          <textarea
            id="secret-value"
            readOnly
            value={secret}
            rows={3}
            style={textareaStyle}
          />
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button onClick={handleCopy} style={copyButtonStyle}>
            {copied ? 'Copied!' : 'Copy to Clipboard'}
          </button>
          <button onClick={onClose} style={doneButtonStyle}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.55)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.25)',
  maxWidth: 480,
  width: '92%',
};

const warningStyle: React.CSSProperties = {
  padding: 12,
  marginBottom: 16,
  borderRadius: 6,
  background: '#fef3c7',
  color: '#92400e',
  fontSize: 13,
  border: '1px solid #fcd34d',
};

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 600,
  color: '#334155',
};

const textareaStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 12,
  fontFamily: 'monospace',
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  resize: 'none',
  boxSizing: 'border-box',
  background: '#f8fafc',
  color: '#1e293b',
};

const copyButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 6,
  border: '1px solid #6366f1',
  background: '#eef2ff',
  color: '#3730a3',
  cursor: 'pointer',
};

const doneButtonStyle: React.CSSProperties = {
  padding: '8px 20px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 6,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
};
