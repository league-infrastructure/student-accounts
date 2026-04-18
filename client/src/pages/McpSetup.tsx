import { Link } from 'react-router-dom';

export function McpSetupContent() {
  return (
    <>
      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>MCP Endpoint URL</h2>
        <p style={styles.text}>
          The MCP endpoint is available at the following URLs depending on your
          environment:
        </p>
        <div style={styles.codeBlock}>
          <div style={styles.codeLine}>
            <strong>Local dev:</strong> http://localhost:3000/api/mcp
          </div>
          <div style={styles.codeLine}>
            <strong>Production:</strong> https://&lt;domain&gt;/api/mcp
          </div>
        </div>
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Token Configuration</h2>
        <p style={styles.text}>
          To authenticate with the MCP endpoint, set the{' '}
          <code style={styles.inlineCode}>MCP_DEFAULT_TOKEN</code> environment
          variable in your secrets file:
        </p>
        <div style={styles.codeBlock}>
          <code>config/dev/secrets.env</code>
        </div>
        <p style={{ ...styles.text, marginTop: '0.75rem' }}>
          Add a line like: <code style={styles.inlineCode}>MCP_DEFAULT_TOKEN=your-secret-token</code>
        </p>
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Claude Desktop Configuration</h2>
        <p style={styles.text}>
          Add the following to your Claude Desktop MCP configuration file:
        </p>
        <pre style={styles.codeBlock}>{`{
  "mcpServers": {
    "chat-app": {
      "url": "http://localhost:3000/api/mcp",
      "headers": {
        "Authorization": "Bearer YOUR_MCP_TOKEN"
      }
    }
  }
}`}</pre>
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Example curl Command</h2>
        <p style={styles.text}>
          Test the MCP endpoint from the command line:
        </p>
        <pre style={styles.codeBlock}>{`curl -X POST http://localhost:3000/api/mcp \\
  -H "Authorization: Bearer YOUR_MCP_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_channels","arguments":{}},"id":1}'`}</pre>
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Available Tools</h2>
        <ul style={styles.list}>
          <li style={styles.listItem}>
            <code style={styles.inlineCode}>get_version</code> — Get the
            application version
          </li>
          <li style={styles.listItem}>
            <code style={styles.inlineCode}>list_users</code> — List all users
          </li>
          <li style={styles.listItem}>
            <code style={styles.inlineCode}>list_channels</code> — List all
            chat channels
          </li>
          <li style={styles.listItem}>
            <code style={styles.inlineCode}>get_channel_messages</code> — Get
            messages from a channel (params:{' '}
            <code style={styles.inlineCode}>channelId</code>,{' '}
            <code style={styles.inlineCode}>limit?</code>)
          </li>
          <li style={styles.listItem}>
            <code style={styles.inlineCode}>post_message</code> — Post a
            message to a channel (params:{' '}
            <code style={styles.inlineCode}>channelId</code>,{' '}
            <code style={styles.inlineCode}>content</code>)
          </li>
          <li style={styles.listItem}>
            <code style={styles.inlineCode}>create_channel</code> — Create a
            new channel (params:{' '}
            <code style={styles.inlineCode}>name</code>,{' '}
            <code style={styles.inlineCode}>description?</code>)
          </li>
        </ul>
      </section>

    </>
  );
}

export default function McpSetup() {
  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>MCP Setup</h1>
        <p style={styles.version}>Connect external MCP clients to the application</p>
      </header>
      <McpSetupContent />
      <footer style={styles.footer}>
        <Link to="/" style={styles.backLink}>
          &larr; Back to Home
        </Link>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 640,
    margin: '40px auto',
    padding: '0 1rem',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    marginBottom: '2rem',
    textAlign: 'center' as const,
  },
  title: {
    fontSize: '2rem',
    marginBottom: '0.25rem',
    color: '#1e293b',
  },
  version: {
    color: '#94a3b8',
    fontSize: '0.9rem',
    marginTop: '0.25rem',
  },
  card: {
    padding: '1.5rem',
    border: '1px solid #e0e0e0',
    borderRadius: 12,
    background: '#fafafa',
    marginBottom: '1.25rem',
  },
  sectionTitle: {
    fontSize: '1.15rem',
    marginTop: 0,
    marginBottom: '0.75rem',
    color: '#4f46e5',
  },
  text: {
    fontSize: '0.95rem',
    color: '#4b5563',
    lineHeight: 1.6,
    margin: 0,
  },
  codeBlock: {
    background: '#1e293b',
    color: '#e2e8f0',
    padding: '1rem',
    borderRadius: 8,
    fontSize: '0.85rem',
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
    overflowX: 'auto' as const,
    marginTop: '0.75rem',
    lineHeight: 1.7,
    whiteSpace: 'pre' as const,
  },
  codeLine: {
    marginBottom: '0.25rem',
  },
  inlineCode: {
    background: '#e0e7ff',
    color: '#3730a3',
    padding: '0.15rem 0.4rem',
    borderRadius: 4,
    fontSize: '0.85rem',
    fontFamily: "'SFMono-Regular', Consolas, 'Liberation Mono', Menlo, monospace",
  },
  list: {
    margin: 0,
    paddingLeft: '1.25rem',
  },
  listItem: {
    fontSize: '0.95rem',
    color: '#4b5563',
    lineHeight: 1.6,
    marginBottom: '0.5rem',
  },
  footer: {
    marginTop: '2rem',
    textAlign: 'center' as const,
  },
  backLink: {
    color: '#4f46e5',
    fontSize: '0.9rem',
    textDecoration: 'none',
  },
};
