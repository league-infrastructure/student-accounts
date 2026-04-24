import { useState } from 'react';

interface LlmProxyGrantModalProps {
  isOpen: boolean;
  onCancel: () => void;
  onConfirm: (expiresAt: string, tokenLimit: number) => void;
  isLoading?: boolean;
}

export function LlmProxyGrantModal({ isOpen, onCancel, onConfirm, isLoading }: LlmProxyGrantModalProps) {
  const [expiresAtStr, setExpiresAtStr] = useState(
    new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  );
  const [tokenLimitStr, setTokenLimitStr] = useState('1000000');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  function handleConfirm() {
    setError(null);
    const tokenLimit = parseInt(tokenLimitStr, 10);
    if (!Number.isFinite(tokenLimit) || tokenLimit <= 0) {
      setError('Token limit must be a positive integer.');
      return;
    }
    onConfirm(expiresAtStr, tokenLimit);
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2 style={{ marginTop: 0, marginBottom: 16, fontSize: 18 }}>Grant LLM Proxy Access</h2>

        {error && (
          <div style={{ ...errorBannerStyle }}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#334155' }}>
            Expiration Date/Time (ISO 8601)
          </label>
          <input
            type="text"
            value={expiresAtStr}
            onChange={(e) => setExpiresAtStr(e.currentTarget.value)}
            placeholder="2026-05-31T17:00:00Z"
            style={inputStyle}
            disabled={isLoading}
          />
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Example: 2026-05-31T17:00:00Z
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#334155' }}>
            Token Limit per User
          </label>
          <input
            type="text"
            value={tokenLimitStr}
            onChange={(e) => setTokenLimitStr(e.currentTarget.value)}
            placeholder="1000000"
            style={inputStyle}
            disabled={isLoading}
          />
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Example: 1000000
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            onClick={onCancel}
            style={cancelButtonStyle}
            disabled={isLoading}
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            style={confirmButtonStyle}
            disabled={isLoading}
          >
            {isLoading ? 'Granting...' : 'Grant Access'}
          </button>
        </div>
      </div>
    </div>
  );
}

const overlayStyle: React.CSSProperties = {
  position: 'fixed',
  top: 0,
  left: 0,
  right: 0,
  bottom: 0,
  background: 'rgba(0, 0, 0, 0.5)',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  zIndex: 9999,
};

const modalStyle: React.CSSProperties = {
  background: '#fff',
  borderRadius: 8,
  padding: 24,
  boxShadow: '0 10px 25px rgba(0, 0, 0, 0.2)',
  maxWidth: 400,
  width: '90%',
};

const inputStyle: React.CSSProperties = {
  width: '100%',
  padding: '8px 12px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 6,
  fontFamily: 'monospace',
  boxSizing: 'border-box',
};

const errorBannerStyle: React.CSSProperties = {
  padding: 10,
  marginBottom: 16,
  borderRadius: 6,
  background: '#fee2e2',
  color: '#991b1b',
  fontSize: 13,
};

const cancelButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  background: '#f8fafc',
  color: '#334155',
  cursor: 'pointer',
};

const confirmButtonStyle: React.CSSProperties = {
  padding: '8px 16px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 6,
  border: 'none',
  background: '#2563eb',
  color: '#fff',
  cursor: 'pointer',
};
