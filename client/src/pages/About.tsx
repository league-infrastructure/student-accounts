import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';

const FALLBACK_NAME = 'Chat App';
const FALLBACK_VERSION = '0.1.0';

export default function About() {
  const [appName, setAppName] = useState<string>(FALLBACK_NAME);
  const [version, setVersion] = useState<string>(FALLBACK_VERSION);

  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.version) setVersion(data.version);
        if (data?.appName) setAppName(data.appName);
      })
      .catch(() => {
        // Keep fallback values
      });
  }, []);

  return (
    <div style={styles.container}>
      <header style={styles.header}>
        <h1 style={styles.title}>{appName}</h1>
        <p style={styles.version}>Version {version}</p>
      </header>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>About</h2>
        <p style={styles.text}>
          A real-time chat application built with the docker-node-template
          stack. Create channels, send messages, and collaborate with your team.
        </p>
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Features</h2>
        <ul style={styles.list}>
          <li style={styles.listItem}>
            <strong>Channels</strong> — Create and join channels to organize
            conversations by topic.
          </li>
          <li style={styles.listItem}>
            <strong>Real-time Chat</strong> — Send and receive messages in
            real time with channel-based discussions.
          </li>
          <li style={styles.listItem}>
            <strong>OAuth Login</strong> — Sign in with GitHub or Google.
          </li>
          <li style={styles.listItem}>
            <strong>Admin Panel</strong> — Manage users, channels, scheduled
            jobs, and system configuration.
          </li>
        </ul>
      </section>

      <section style={styles.card}>
        <h2 style={styles.sectionTitle}>Technology</h2>
        <p style={styles.text}>
          Built with React, Express, TypeScript, and PostgreSQL. Deployed
          via Docker Swarm with SOPS-encrypted secrets.
        </p>
      </section>

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
