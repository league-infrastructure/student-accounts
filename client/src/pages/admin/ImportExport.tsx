import { useEffect, useState, useCallback } from 'react';

interface Backup {
  filename: string;
  size: number;
  created: string;
  s3?: boolean;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatDate(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleString();
}

export default function ImportExport() {
  const [backups, setBackups] = useState<Backup[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('');
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const loadBackups = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/backups');
      if (!res.ok) throw new Error('Failed to load backups');
      const data = await res.json();
      setBackups(data);
      setError('');
    } catch {
      setError('Failed to load backups');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadBackups();
  }, [loadBackups]);

  const handleExportJson = () => {
    window.open('/api/admin/export/json', '_blank');
  };

  const handleCreateBackup = async () => {
    setCreating(true);
    setError('');
    setStatus('');
    try {
      const res = await fetch('/api/admin/backups', { method: 'POST' });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to create backup');
        return;
      }
      const result = await res.json();
      const s3Note = result.s3 ? ' (uploaded to S3)' : result.s3 === false ? ' (S3 upload failed)' : '';
      setStatus(`Backup created: ${result.filename}${s3Note}`);
      await loadBackups();
    } catch {
      setError('Network error creating backup');
    } finally {
      setCreating(false);
    }
  };

  const handleRestore = async (filename: string) => {
    const confirmed = window.confirm(
      `Are you sure you want to restore from "${filename}"? This will overwrite the current database.`
    );
    if (!confirmed) return;

    setRestoringId(filename);
    setError('');
    setStatus('');
    try {
      const res = await fetch(`/api/admin/backups/${encodeURIComponent(filename)}/restore`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to restore backup');
        return;
      }
      setStatus(`Backup "${filename}" restored successfully.`);
    } catch {
      setError('Network error restoring backup');
    } finally {
      setRestoringId(null);
    }
  };

  const handleDelete = async (filename: string) => {
    const confirmed = window.confirm(`Delete backup "${filename}"? This cannot be undone.`);
    if (!confirmed) return;

    setDeletingId(filename);
    setError('');
    setStatus('');
    try {
      const res = await fetch(`/api/admin/backups/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to delete backup');
        return;
      }
      setStatus(`Backup "${filename}" deleted.`);
      await loadBackups();
    } catch {
      setError('Network error deleting backup');
    } finally {
      setDeletingId(null);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1>Import / Export</h1>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
        Export data as JSON, create and manage PostgreSQL backups.
      </p>

      {error && (
        <div style={{
          padding: '10px 16px',
          marginBottom: 16,
          borderRadius: 4,
          background: '#fce8e6',
          color: '#c5221f',
          border: '1px solid #ea4335',
        }}>
          {error}
        </div>
      )}

      {status && (
        <div style={{
          padding: '10px 16px',
          marginBottom: 16,
          borderRadius: 4,
          background: '#e6f4ea',
          color: '#137333',
          border: '1px solid #34a853',
        }}>
          {status}
        </div>
      )}

      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        <button
          onClick={handleExportJson}
          style={{ padding: '8px 16px', cursor: 'pointer' }}
        >
          Export JSON
        </button>
        <button
          onClick={handleCreateBackup}
          disabled={creating}
          style={{ padding: '8px 16px', cursor: creating ? 'default' : 'pointer' }}
        >
          {creating ? 'Creating...' : 'Create Backup'}
        </button>
      </div>

      <h2 style={{ fontSize: 16, marginBottom: 12 }}>Backups</h2>

      <div style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: 16,
      }}>
        {backups.length === 0 ? (
          <p style={{ color: '#999' }}>No backups found.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                <th style={{ padding: '8px 8px 8px 0' }}>Filename</th>
                <th style={{ padding: 8 }}>Created</th>
                <th style={{ padding: 8 }}>Size</th>
                <th style={{ padding: 8 }}>S3</th>
                <th style={{ padding: '8px 0 8px 8px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {backups.map((backup) => (
                <tr key={backup.filename} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 8px 8px 0', fontFamily: 'monospace', fontSize: 13 }}>
                    {backup.filename}
                  </td>
                  <td style={{ padding: 8, color: '#666', fontSize: 13 }}>
                    {formatDate(backup.created)}
                  </td>
                  <td style={{ padding: 8, color: '#666', fontSize: 13 }}>
                    {formatSize(backup.size)}
                  </td>
                  <td style={{ padding: 8, fontSize: 13 }}>
                    {backup.s3 ? (
                      <span style={{ color: '#137333' }} title="Stored in S3">yes</span>
                    ) : (
                      <span style={{ color: '#999' }}>local</span>
                    )}
                  </td>
                  <td style={{ padding: '8px 0 8px 8px', textAlign: 'right' }}>
                    <button
                      onClick={() => handleRestore(backup.filename)}
                      disabled={restoringId === backup.filename}
                      style={{
                        marginRight: 8,
                        padding: '4px 10px',
                        cursor: restoringId === backup.filename ? 'default' : 'pointer',
                      }}
                    >
                      {restoringId === backup.filename ? 'Restoring...' : 'Restore'}
                    </button>
                    <button
                      onClick={() => handleDelete(backup.filename)}
                      disabled={deletingId === backup.filename}
                      style={{
                        padding: '4px 10px',
                        cursor: deletingId === backup.filename ? 'default' : 'pointer',
                        color: '#c5221f',
                      }}
                    >
                      {deletingId === backup.filename ? 'Deleting...' : 'Delete'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
