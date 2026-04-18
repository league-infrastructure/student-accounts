import { useEffect, useState } from 'react';

interface ConfigEntry {
  key: string;
  group: string;
  label: string;
  value: string | null;
  source: 'environment' | 'database' | 'not set';
  isSecret: boolean;
  requiresRestart: boolean;
}

interface SaveResult {
  success: boolean;
  warning?: string;
  restart?: boolean;
}

export default function ConfigPanel() {
  const [entries, setEntries] = useState<ConfigEntry[]>([]);
  const [editing, setEditing] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);
  const [error, setError] = useState('');

  const loadConfig = () => {
    fetch('/api/admin/config')
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => setError('Failed to load configuration'));
  };

  useEffect(() => { loadConfig(); }, []);

  useEffect(() => {
    if (toast) {
      const timer = setTimeout(() => setToast(null), 4000);
      return () => clearTimeout(timer);
    }
  }, [toast]);

  const handleSave = async (key: string) => {
    setSaving(true);
    try {
      const res = await fetch('/api/admin/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: editValue }),
      });
      const data: SaveResult & { error?: string } = await res.json();
      if (!res.ok) {
        setToast({ message: data.error || 'Save failed', type: 'error' });
      } else {
        let msg = 'Saved successfully';
        if (data.warning) msg += `. ${data.warning}`;
        if (data.restart) msg += '. Restart required for this change to take effect.';
        setToast({ message: msg, type: 'success' });
        setEditing(null);
        loadConfig();
      }
    } catch {
      setToast({ message: 'Network error', type: 'error' });
    } finally {
      setSaving(false);
    }
  };

  const handleExport = () => {
    window.location.href = '/api/admin/config/export';
  };

  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  // Group entries
  const groups: Record<string, ConfigEntry[]> = {};
  for (const entry of entries) {
    if (!groups[entry.group]) groups[entry.group] = [];
    groups[entry.group].push(entry);
  }

  const sourceBadge = (source: ConfigEntry['source']) => {
    const colors: Record<string, string> = {
      environment: '#1a73e8',
      database: '#34a853',
      'not set': '#999',
    };
    return (
      <span style={{
        fontSize: 11,
        padding: '2px 6px',
        borderRadius: 3,
        background: colors[source] + '20',
        color: colors[source],
        fontWeight: 600,
      }}>
        {source}
      </span>
    );
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Configuration</h1>
        <button onClick={handleExport} style={{ padding: '8px 16px', cursor: 'pointer' }}>
          Export .env
        </button>
      </div>

      {toast && (
        <div style={{
          padding: '10px 16px',
          marginBottom: 16,
          borderRadius: 4,
          background: toast.type === 'success' ? '#e6f4ea' : '#fce8e6',
          color: toast.type === 'success' ? '#1e7e34' : '#c5221f',
          border: `1px solid ${toast.type === 'success' ? '#34a853' : '#ea4335'}`,
        }}>
          {toast.message}
        </div>
      )}

      {Object.entries(groups).map(([group, items]) => (
        <div key={group} style={{
          border: '1px solid #ddd',
          borderRadius: 8,
          padding: 16,
          marginBottom: 16,
        }}>
          <h3 style={{ marginTop: 0 }}>{group}</h3>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <tbody>
              {items.map((entry) => (
                <tr key={entry.key} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 0', width: 200 }}>
                    <strong>{entry.label}</strong>
                    {entry.requiresRestart && (
                      <span style={{
                        fontSize: 10,
                        marginLeft: 6,
                        padding: '1px 5px',
                        borderRadius: 3,
                        background: '#fff3e0',
                        color: '#e65100',
                      }}>
                        restart required
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 8px' }}>
                    {editing === entry.key ? (
                      <input
                        type="text"
                        value={editValue}
                        onChange={(e) => setEditValue(e.target.value)}
                        style={{ width: '100%', padding: 4, fontFamily: 'monospace', fontSize: 13 }}
                        autoFocus
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSave(entry.key);
                          if (e.key === 'Escape') setEditing(null);
                        }}
                      />
                    ) : (
                      <span style={{ fontFamily: 'monospace', fontSize: 13, color: entry.value ? '#333' : '#999' }}>
                        {entry.value || '—'}
                      </span>
                    )}
                  </td>
                  <td style={{ padding: '8px 8px', width: 80 }}>
                    {sourceBadge(entry.source)}
                  </td>
                  <td style={{ padding: '8px 0', width: 120, textAlign: 'right' }}>
                    {editing === entry.key ? (
                      <>
                        <button
                          onClick={() => handleSave(entry.key)}
                          disabled={saving}
                          style={{ marginRight: 4, cursor: 'pointer' }}
                        >
                          {saving ? 'Saving...' : 'Save'}
                        </button>
                        <button onClick={() => setEditing(null)} style={{ cursor: 'pointer' }}>
                          Cancel
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={() => { setEditing(entry.key); setEditValue(''); }}
                        style={{ cursor: 'pointer' }}
                      >
                        Edit
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ))}

      <p style={{ color: '#666', fontSize: 12 }}>
        Environment variables take precedence over database values. Changes to OAuth credentials require a server restart.
      </p>
    </div>
  );
}
