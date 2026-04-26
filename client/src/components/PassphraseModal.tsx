import { useState, useEffect } from 'react';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PassphraseRecord {
  plaintext: string;
  expiresAt: string;
  grantLlmProxy: boolean;
  createdAt: string;
}

interface Props {
  isOpen: boolean;
  scope: { kind: 'group' | 'cohort'; id: number; name: string };
  onClose: () => void;
  onCreated: (result: PassphraseRecord) => void;
}

// ---------------------------------------------------------------------------
// Client-side word list (kid-safe, ~100 simple words)
// A small subset sufficient for generating 3-word suggestions.
// The admin can always edit before submitting.
// ---------------------------------------------------------------------------

const CLIENT_WORDS: readonly string[] = [
  'ant', 'ape', 'bear', 'bee', 'bird', 'bunny', 'camel', 'cat', 'chimp',
  'clam', 'crab', 'crow', 'deer', 'dog', 'dove', 'duck', 'elk', 'fawn',
  'fish', 'frog', 'goat', 'hen', 'jay', 'lamb', 'lark', 'lion', 'lynx',
  'mole', 'moth', 'newt', 'owl', 'pony', 'pup', 'ram', 'robin', 'slug',
  'swan', 'toad', 'wren', 'yak',
  'apple', 'bean', 'beet', 'berry', 'bread', 'cake', 'carrot', 'cherry',
  'corn', 'date', 'fig', 'grape', 'kiwi', 'lemon', 'lime', 'mango',
  'melon', 'mint', 'onion', 'peach', 'pear', 'pea', 'plum', 'rice',
  'salad', 'toast',
  'blue', 'coral', 'cream', 'gold', 'green', 'grey', 'indigo', 'jade',
  'olive', 'pink', 'plum', 'red', 'rose', 'ruby', 'sage', 'teal', 'white',
  'acorn', 'brook', 'cave', 'cloud', 'dawn', 'delta', 'dew', 'dune',
  'field', 'fjord', 'grove', 'gust', 'hill', 'knoll', 'lake', 'leaf',
  'marsh', 'mist', 'moon', 'moss', 'peak', 'pond', 'rain', 'reef',
  'ridge', 'river', 'rock', 'seed', 'slope', 'snow', 'star', 'stem',
  'storm', 'sun', 'tide', 'tree', 'vale', 'wave',
];

function generateSuggestion(): string {
  const words: string[] = [];
  for (let i = 0; i < 3; i++) {
    const idx = Math.floor(Math.random() * CLIENT_WORDS.length);
    words.push(CLIENT_WORDS[idx]);
  }
  return words.join('-');
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function PassphraseModal({ isOpen, scope, onClose, onCreated }: Props) {
  const [plaintextInput, setPlaintextInput] = useState('');
  const [grantLlmProxy, setGrantLlmProxy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Generate a suggestion whenever the modal opens
  useEffect(() => {
    if (isOpen) {
      setPlaintextInput(generateSuggestion());
      setGrantLlmProxy(false);
      setError(null);
      setSubmitting(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  function handleRegenerate() {
    setPlaintextInput(generateSuggestion());
  }

  async function handleCreate() {
    const trimmed = plaintextInput.trim();
    if (!trimmed) {
      setError('Passphrase cannot be empty.');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/${scope.kind}s/${scope.id}/passphrase`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plaintext: trimmed, grantLlmProxy }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
      }
      const result: PassphraseRecord = await res.json();
      onCreated(result);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Failed to create passphrase.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={overlayStyle}>
      <div style={modalStyle}>
        <h2 style={{ marginTop: 0, marginBottom: 4, fontSize: 18 }}>Create passphrase</h2>
        <p style={{ margin: '0 0 16px', fontSize: 13, color: '#64748b' }}>
          For {scope.kind} <strong>{scope.name}</strong>
        </p>

        {error && (
          <div style={errorBannerStyle}>
            {error}
          </div>
        )}

        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 6, fontSize: 13, fontWeight: 600, color: '#334155' }}>
            Passphrase
          </label>
          <div style={{ display: 'flex', gap: 8 }}>
            <input
              type="text"
              value={plaintextInput}
              onChange={(e) => setPlaintextInput(e.currentTarget.value)}
              placeholder="three-word-phrase"
              style={{ ...inputStyle, flex: 1 }}
              disabled={submitting}
              aria-label="Passphrase"
            />
            <button
              type="button"
              onClick={handleRegenerate}
              disabled={submitting}
              style={regenButtonStyle}
            >
              Regenerate
            </button>
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 4 }}>
            Students will type this to create their account. You can edit it before saving.
          </div>
        </div>

        <div style={{ marginBottom: 20 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: '#334155', cursor: 'pointer' }}>
            <input
              type="checkbox"
              checked={grantLlmProxy}
              onChange={(e) => setGrantLlmProxy(e.currentTarget.checked)}
              disabled={submitting}
              aria-label="Also grant an LLM proxy token when students sign up"
            />
            <span>Also grant an LLM proxy token when students sign up</span>
          </label>
        </div>

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button
            type="button"
            onClick={onClose}
            style={cancelButtonStyle}
            disabled={submitting}
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleCreate}
            style={confirmButtonStyle}
            disabled={submitting}
          >
            {submitting ? 'Creating…' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles (matching LlmProxyGrantModal vocabulary)
// ---------------------------------------------------------------------------

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
  maxWidth: 440,
  width: '90%',
};

const inputStyle: React.CSSProperties = {
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

const regenButtonStyle: React.CSSProperties = {
  padding: '8px 12px',
  fontSize: 13,
  fontWeight: 600,
  borderRadius: 6,
  border: '1px solid #cbd5e1',
  background: '#f8fafc',
  color: '#334155',
  cursor: 'pointer',
  whiteSpace: 'nowrap',
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
