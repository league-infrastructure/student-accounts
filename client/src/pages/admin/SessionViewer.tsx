import { useEffect, useState } from 'react';

interface SessionInfo {
  sid: string;
  expire: string;
  hasUser: boolean;
  userEmail: string | null;
  userName: string | null;
  userRole: string | null;
}

export default function SessionViewer() {
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const loadSessions = () => {
    setLoading(true);
    fetch('/api/admin/sessions')
      .then((r) => r.json())
      .then((data) => { setSessions(data); setLoading(false); })
      .catch(() => { setError('Failed to load sessions'); setLoading(false); });
  };

  useEffect(() => { loadSessions(); }, []);

  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  const isExpiringSoon = (expire: string) => {
    const diff = new Date(expire).getTime() - Date.now();
    return diff > 0 && diff < 60 * 60 * 1000; // within 1 hour
  };

  const formatExpiry = (expire: string) => {
    const d = new Date(expire);
    return d.toLocaleString();
  };

  const badgeStyle = (bg: string, color: string): React.CSSProperties => ({
    fontSize: 11,
    padding: '1px 6px',
    borderRadius: 3,
    background: bg,
    color,
    fontWeight: 600,
    marginRight: 4,
  });

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <h1>Sessions</h1>
        <button onClick={loadSessions} disabled={loading} style={{ padding: '4px 12px', cursor: 'pointer' }}>
          {loading ? 'Loading...' : 'Refresh'}
        </button>
      </div>

      {sessions.length === 0 ? (
        <p style={{ color: '#666' }}>No active sessions.</p>
      ) : (
        <>
          <p style={{ color: '#666', fontSize: 13 }}>{sessions.length} active session{sessions.length !== 1 ? 's' : ''}</p>
          <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>Session ID</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>User</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>Role</th>
                <th style={{ textAlign: 'left', padding: '6px 10px', borderBottom: '2px solid #ddd' }}>Expires</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => (
                <tr
                  key={s.sid}
                  style={{
                    borderBottom: '1px solid #eee',
                    background: isExpiringSoon(s.expire) ? '#fff8e1' : 'transparent',
                  }}
                >
                  <td style={{ padding: '6px 10px', fontFamily: 'monospace' }}>{s.sid}...</td>
                  <td style={{ padding: '6px 10px' }}>
                    {s.hasUser && s.userEmail ? (
                      <span>
                        <span style={{ fontWeight: 500 }}>{s.userName || s.userEmail}</span>
                        {s.userName && (
                          <span style={{ color: '#666', marginLeft: 6, fontSize: 12 }}>{s.userEmail}</span>
                        )}
                      </span>
                    ) : (
                      <span style={{ color: '#999' }}>Anonymous</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 10px' }}>
                    {s.userRole === 'ADMIN' ? (
                      <span style={badgeStyle('#e8f0fe', '#1a73e8')}>admin</span>
                    ) : s.userRole === 'USER' ? (
                      <span style={badgeStyle('#e6f4ea', '#1e7e34')}>user</span>
                    ) : (
                      <span style={{ color: '#999' }}>-</span>
                    )}
                  </td>
                  <td style={{ padding: '6px 10px', color: isExpiringSoon(s.expire) ? '#e65100' : '#333' }}>
                    {formatExpiry(s.expire)}
                    {isExpiringSoon(s.expire) && (
                      <span style={{ marginLeft: 6, fontSize: 11, color: '#e65100' }}>expiring soon</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
    </div>
  );
}
