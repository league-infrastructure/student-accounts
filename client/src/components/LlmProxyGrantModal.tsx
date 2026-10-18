import { useState } from 'react';

/** Largest monthly budget the admin API accepts (LLM_PROXY_MAX_BUDGET_USD). */
export const LLM_PROXY_MAX_BUDGET_USD = 1000;

interface LlmProxyGrantModalProps {
  isOpen: boolean;
  onCancel: () => void;
  /**
   * `budgetUsd` is the monthly dollar budget; `tokenLimit` is the optional
   * legacy token-count quota (undefined → server default).
   */
  onConfirm: (expiresAt: string, budgetUsd: number, tokenLimit?: number) => void;
  isLoading?: boolean;
  /** Pre-filled budget; defaults to the server's $5. */
  defaultBudgetUsd?: number;
}

export function LlmProxyGrantModal({
  isOpen,
  onCancel,
  onConfirm,
  isLoading,
  defaultBudgetUsd = 5,
}: LlmProxyGrantModalProps) {
  const [expiresAtStr, setExpiresAtStr] = useState(
    new Date(Date.now() + 30 * 24 * 3600 * 1000).toISOString(),
  );
  const [budgetStr, setBudgetStr] = useState(String(defaultBudgetUsd));
  const [tokenLimitStr, setTokenLimitStr] = useState('');
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  function handleConfirm() {
    setError(null);
    const budgetUsd = Number(budgetStr.trim());
    if (
      budgetStr.trim() === '' ||
      !Number.isFinite(budgetUsd) ||
      budgetUsd <= 0 ||
      budgetUsd > LLM_PROXY_MAX_BUDGET_USD
    ) {
      setError(`Monthly budget must be a positive dollar amount up to $${LLM_PROXY_MAX_BUDGET_USD}.`);
      return;
    }
    let tokenLimit: number | undefined;
    if (tokenLimitStr.trim() !== '') {
      tokenLimit = parseInt(tokenLimitStr, 10);
      if (!Number.isFinite(tokenLimit) || tokenLimit <= 0) {
        setError('Token limit, when given, must be a positive integer.');
        return;
      }
    }
    onConfirm(expiresAtStr, budgetUsd, tokenLimit);
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
          <label style={labelStyle}>
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
          <div style={hintStyle}>
            Example: 2026-05-31T17:00:00Z
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <label style={labelStyle}>
            Monthly Budget (USD)
          </label>
          <input
            type="text"
            inputMode="decimal"
            value={budgetStr}
            onChange={(e) => setBudgetStr(e.currentTarget.value)}
            placeholder="5"
            style={inputStyle}
            disabled={isLoading}
          />
          <div style={hintStyle}>
            Dollars per calendar month (UTC); spend resets on the 1st. Example: 5
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={labelStyle}>
            Token Limit (optional)
          </label>
          <input
            type="text"
            value={tokenLimitStr}
            onChange={(e) => setTokenLimitStr(e.currentTarget.value)}
            placeholder="server default"
            style={inputStyle}
            disabled={isLoading}
          />
          <div style={hintStyle}>
            Legacy lifetime token cap. Leave blank to use the server default.
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

const labelStyle: React.CSSProperties = {
  display: 'block',
  marginBottom: 6,
  fontSize: 13,
  fontWeight: 600,
  color: '#334155',
};

const hintStyle: React.CSSProperties = {
  fontSize: 12,
  color: '#64748b',
  marginTop: 4,
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
