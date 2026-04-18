import { Link } from 'react-router-dom';

export default function NotFound() {
  return (
    <div style={styles.container}>
      <h1 style={styles.code}>404</h1>
      <h2 style={styles.title}>Page Not Found</h2>
      <p style={styles.text}>
        The page you're looking for doesn't exist or has been moved.
      </p>
      <Link to="/" style={styles.link}>
        &larr; Back to Home
      </Link>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    maxWidth: 500,
    margin: '80px auto',
    padding: '0 1rem',
    textAlign: 'center' as const,
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  code: {
    fontSize: '4rem',
    color: '#cbd5e1',
    margin: 0,
    lineHeight: 1,
  },
  title: {
    fontSize: '1.5rem',
    color: '#1e293b',
    marginTop: '0.5rem',
    marginBottom: '0.75rem',
  },
  text: {
    color: '#64748b',
    fontSize: '0.95rem',
    marginBottom: '1.5rem',
  },
  link: {
    color: '#4f46e5',
    fontSize: '0.9rem',
    textDecoration: 'none',
  },
};
