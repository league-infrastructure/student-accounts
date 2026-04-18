import { useEffect, useState } from 'react';

interface LogEntry {
  timestamp: string;
  level: number;
  msg: string;
  req?: { method: string; url: string };
  res?: { statusCode: number };
  err?: { message: string; stack?: string };
}

const LEVEL_LABELS: Record<number, string> = {
  10: 'TRACE', 20: 'DEBUG', 30: 'INFO', 40: 'WARN', 50: 'ERROR', 60: 'FATAL',
};

const LEVEL_COLORS: Record<number, string> = {
  10: '#999', 20: '#666', 30: '#1a73e8', 40: '#e65100', 50: '#c5221f', 60: '#b71c1c',
};

const FILTER_OPTIONS = [
  { value: '', label: 'All levels' },
  { value: '30', label: 'Info+' },
  { value: '40', label: 'Warn+' },
  { value: '50', label: 'Error+' },
];

export default function LogViewer() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [total, setTotal] = useState(0);
  const [level, setLevel] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadLogs = () => {
    setLoading(true);
    const params = level ? `?level=${level}` : '';
    fetch(`/api/admin/logs${params}`)
      .then((r) => r.json())
      .then((data) => {
        setEntries(data.entries);
        setTotal(data.total);
        setLoading(false);
      })
      .catch(() => { setError('Failed to load logs'); setLoading(false); });
  };

  useEffect(() => { loadLogs(); }, [level]);

  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  const levelBadge = (lvl: number) => {
    const label = LEVEL_LABELS[lvl] || `L${lvl}`;
    const color = LEVEL_COLORS[lvl] || '#666';
    return (
      <span style={{
        fontSize: 11,
        padding: '1px 6px',
        borderRadius: 3,
        background: color + '18',
        color,
        fontWeight: 600,
        fontFamily: 'monospace',
      }}>
        {label}
      </span>
    );
  };

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString(undefined, { hour12: false, fractionalSecondDigits: 3 });
    } catch {
      return ts;
    }
  };

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Logs</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <select
            value={level}
            onChange={(e) => setLevel(e.target.value)}
            style={{ padding: '4px 8px' }}
          >
            {FILTER_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>{opt.label}</option>
            ))}
          </select>
          <button onClick={loadLogs} disabled={loading} style={{ padding: '4px 12px', cursor: 'pointer' }}>
            {loading ? 'Loading...' : 'Refresh'}
          </button>
          <span style={{ color: '#666', fontSize: 12 }}>{total} entries in buffer</span>
        </div>
      </div>

      {entries.length === 0 ? (
        <p style={{ color: '#666' }}>No log entries{level ? ' at this level' : ''}.</p>
      ) : (
        <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd', whiteSpace: 'nowrap' }}>Time</th>
              <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>Level</th>
              <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>Message</th>
              <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>Request</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((entry, i) => (
              <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                <td style={{ padding: '4px 10px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12, color: '#666' }}>
                  {formatTime(entry.timestamp)}
                </td>
                <td style={{ padding: '4px 10px' }}>
                  {levelBadge(entry.level)}
                </td>
                <td style={{ padding: '4px 10px' }}>
                  {entry.msg}
                  {entry.err && (
                    <details style={{ marginTop: 4 }}>
                      <summary style={{ cursor: 'pointer', color: '#c5221f', fontSize: 12 }}>
                        {entry.err.message}
                      </summary>
                      {entry.err.stack && (
                        <pre style={{ fontSize: 11, color: '#666', overflow: 'auto', maxWidth: 600 }}>
                          {entry.err.stack}
                        </pre>
                      )}
                    </details>
                  )}
                </td>
                <td style={{ padding: '4px 10px', whiteSpace: 'nowrap', fontFamily: 'monospace', fontSize: 12, color: '#666' }}>
                  {entry.req && (
                    <span>
                      {entry.req.method} {entry.req.url}
                      {entry.res && (
                        <span style={{ marginLeft: 6, color: entry.res.statusCode >= 400 ? '#c5221f' : '#34a853' }}>
                          {entry.res.statusCode}
                        </span>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
