import { useEffect, useState } from 'react';

interface EnvData {
  node: string;
  uptime: number;
  memory: { rss: number; heapUsed: number; heapTotal: number };
  deployment: string;
  database: string;
  integrations: Record<string, { configured: boolean }>;
}

function formatUptime(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  const parts = [];
  if (h > 0) parts.push(`${h}h`);
  if (m > 0) parts.push(`${m}m`);
  parts.push(`${s}s`);
  return parts.join(' ');
}

function formatMB(bytes: number): string {
  return (bytes / 1024 / 1024).toFixed(1) + ' MB';
}

const INTEGRATION_LABELS: Record<string, string> = {
  github: 'GitHub OAuth',
  google: 'Google OAuth',
  pike13: 'Pike 13',
  githubToken: 'GitHub Token',
  anthropic: 'Claude API',
  openai: 'OpenAI API',
};

export default function EnvironmentInfo() {
  const [data, setData] = useState<EnvData | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/env')
      .then((r) => r.json())
      .then(setData)
      .catch(() => setError('Failed to load environment info'));
  }, []);

  if (error) return <div style={{ color: 'red' }}>{error}</div>;
  if (!data) return <div>Loading...</div>;

  const cardStyle: React.CSSProperties = {
    border: '1px solid #ddd',
    borderRadius: 8,
    padding: 16,
    marginBottom: 16,
  };

  return (
    <div>
      <h1>Environment</h1>

      <div style={cardStyle}>
        <h3>Runtime</h3>
        <table>
          <tbody>
            <tr><td><strong>Node.js</strong></td><td style={{ paddingLeft: 16 }}>{data.node}</td></tr>
            <tr><td><strong>Uptime</strong></td><td style={{ paddingLeft: 16 }}>{formatUptime(data.uptime)}</td></tr>
            <tr><td><strong>Deployment</strong></td><td style={{ paddingLeft: 16 }}>{data.deployment}</td></tr>
          </tbody>
        </table>
      </div>

      <div style={cardStyle}>
        <h3>Memory</h3>
        <table>
          <tbody>
            <tr><td><strong>RSS</strong></td><td style={{ paddingLeft: 16 }}>{formatMB(data.memory.rss)}</td></tr>
            <tr><td><strong>Heap Used</strong></td><td style={{ paddingLeft: 16 }}>{formatMB(data.memory.heapUsed)}</td></tr>
            <tr><td><strong>Heap Total</strong></td><td style={{ paddingLeft: 16 }}>{formatMB(data.memory.heapTotal)}</td></tr>
          </tbody>
        </table>
      </div>

      <div style={cardStyle}>
        <h3>Database</h3>
        <span style={{
          color: data.database === 'connected' ? 'green' : 'red',
          fontWeight: 'bold',
        }}>
          {data.database === 'connected' ? 'Connected' : 'Disconnected'}
        </span>
      </div>

      <div style={cardStyle}>
        <h3>Integrations</h3>
        <table>
          <tbody>
            {Object.entries(data.integrations).map(([key, val]) => (
              <tr key={key}>
                <td><strong>{INTEGRATION_LABELS[key] || key}</strong></td>
                <td style={{ paddingLeft: 16 }}>
                  <span style={{
                    color: val.configured ? 'green' : '#999',
                    fontWeight: 'bold',
                  }}>
                    {val.configured ? 'Configured' : 'Not set'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
