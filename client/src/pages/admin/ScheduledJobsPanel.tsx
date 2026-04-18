import { useEffect, useState, useCallback } from 'react';

interface ScheduledJob {
  id: number;
  name: string;
  frequency: string;
  enabled: boolean;
  lastRun: string | null;
  nextRun: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

function formatDate(dateStr: string | null): string {
  if (!dateStr) return '--';
  const d = new Date(dateStr);
  return d.toLocaleString();
}

export default function ScheduledJobsPanel() {
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [runningId, setRunningId] = useState<number | null>(null);
  const [togglingId, setTogglingId] = useState<number | null>(null);

  const loadJobs = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/scheduler/jobs');
      if (!res.ok) throw new Error('Failed to load jobs');
      const data = await res.json();
      setJobs(data);
      setError('');
    } catch {
      setError('Failed to load scheduled jobs');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadJobs();
    const interval = setInterval(loadJobs, 30000);
    return () => clearInterval(interval);
  }, [loadJobs]);

  const handleToggle = async (job: ScheduledJob) => {
    setTogglingId(job.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/scheduler/jobs/${job.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !job.enabled }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to update job');
        return;
      }
      await loadJobs();
    } catch {
      setError('Network error');
    } finally {
      setTogglingId(null);
    }
  };

  const handleRunNow = async (job: ScheduledJob) => {
    setRunningId(job.id);
    setError('');
    try {
      const res = await fetch(`/api/admin/scheduler/jobs/${job.id}/run`, {
        method: 'POST',
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error || 'Failed to run job');
        return;
      }
      await loadJobs();
    } catch {
      setError('Network error');
    } finally {
      setRunningId(null);
    }
  };

  if (loading) return <div>Loading...</div>;

  return (
    <div>
      <h1>Scheduled Jobs</h1>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
        Manage scheduled background jobs. Jobs run automatically based on their frequency.
        Auto-refreshes every 30 seconds.
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

      <div style={{
        border: '1px solid #ddd',
        borderRadius: 8,
        padding: 16,
      }}>
        {jobs.length === 0 ? (
          <p style={{ color: '#999' }}>No scheduled jobs configured.</p>
        ) : (
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '2px solid #ddd', textAlign: 'left' }}>
                <th style={{ padding: '8px 8px 8px 0' }}>Name</th>
                <th style={{ padding: 8 }}>Frequency</th>
                <th style={{ padding: 8 }}>Enabled</th>
                <th style={{ padding: 8 }}>Last Run</th>
                <th style={{ padding: 8 }}>Next Run</th>
                <th style={{ padding: 8 }}>Last Error</th>
                <th style={{ padding: '8px 0 8px 8px', textAlign: 'right' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <tr key={job.id} style={{ borderBottom: '1px solid #eee' }}>
                  <td style={{ padding: '8px 8px 8px 0', fontFamily: 'monospace', fontSize: 13 }}>
                    {job.name}
                  </td>
                  <td style={{ padding: 8 }}>
                    <span style={{
                      fontSize: 11,
                      padding: '2px 6px',
                      borderRadius: 3,
                      background: '#e3f2fd',
                      color: '#1565c0',
                      fontWeight: 600,
                    }}>
                      {job.frequency}
                    </span>
                  </td>
                  <td style={{ padding: 8 }}>
                    <button
                      onClick={() => handleToggle(job)}
                      disabled={togglingId === job.id}
                      style={{
                        padding: '4px 12px',
                        borderRadius: 12,
                        border: 'none',
                        cursor: togglingId === job.id ? 'default' : 'pointer',
                        background: job.enabled ? '#e8f5e9' : '#f5f5f5',
                        color: job.enabled ? '#2e7d32' : '#999',
                        fontWeight: 600,
                        fontSize: 12,
                      }}
                    >
                      {togglingId === job.id ? '...' : job.enabled ? 'ON' : 'OFF'}
                    </button>
                  </td>
                  <td style={{ padding: 8, color: '#666', fontSize: 13 }}>
                    {formatDate(job.lastRun)}
                  </td>
                  <td style={{ padding: 8, color: '#666', fontSize: 13 }}>
                    {formatDate(job.nextRun)}
                  </td>
                  <td style={{
                    padding: 8,
                    fontSize: 13,
                    color: job.lastError ? '#c5221f' : '#999',
                    fontFamily: job.lastError ? 'monospace' : 'inherit',
                    maxWidth: 200,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                    title={job.lastError || undefined}
                  >
                    {job.lastError || '--'}
                  </td>
                  <td style={{ padding: '8px 0 8px 8px', textAlign: 'right' }}>
                    <button
                      onClick={() => handleRunNow(job)}
                      disabled={runningId === job.id}
                      style={{
                        cursor: runningId === job.id ? 'default' : 'pointer',
                        padding: '4px 10px',
                      }}
                    >
                      {runningId === job.id ? 'Running...' : 'Run Now'}
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
