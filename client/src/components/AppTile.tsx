/**
 * AppTile — Sprint 016.
 *
 * Presentational component that renders one application tile as a
 * navigable card. Accepts AppTile props from the server-computed tile
 * list and renders an icon, title, description, and a link.
 *
 * Icon mapping: the server sends a short string key. We map a small
 * set of known keys to emoji. Unknown keys fall back to '📌'.
 */

import type React from 'react';
import { Link } from 'react-router-dom';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppTileProps {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: string;
}

// ---------------------------------------------------------------------------
// Icon map
// ---------------------------------------------------------------------------

const ICON_MAP: Record<string, string> = {
  users: '👥',
  directory: '📋',
  bot: '🤖',
  cohort: '🏫',
  group: '🫂',
};

function resolveIcon(key: string): string {
  return ICON_MAP[key] ?? '📌';
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export default function AppTile({ title, description, href, icon }: AppTileProps) {
  const emoji = resolveIcon(icon);

  // Use React Router Link for internal paths; <a> for external.
  const isExternal = /^https?:\/\//.test(href);

  const inner = (
    <div style={styles.card}>
      <span style={styles.icon} aria-hidden="true">{emoji}</span>
      <div style={styles.text}>
        <div style={styles.title}>{title}</div>
        <div style={styles.description}>{description}</div>
      </div>
    </div>
  );

  if (isExternal) {
    return (
      <a href={href} style={styles.link} rel="noreferrer">
        {inner}
      </a>
    );
  }

  return (
    <Link to={href} style={styles.link}>
      {inner}
    </Link>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const styles: Record<string, React.CSSProperties> = {
  link: {
    textDecoration: 'none',
    color: 'inherit',
    display: 'block',
  },
  card: {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: '1.25rem 1.5rem',
    background: '#fff',
    display: 'flex',
    alignItems: 'flex-start',
    gap: '1rem',
    cursor: 'pointer',
    transition: 'box-shadow 0.15s, border-color 0.15s',
  },
  icon: {
    fontSize: '1.75rem',
    lineHeight: 1,
    flexShrink: 0,
  },
  text: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  title: {
    fontWeight: 600,
    fontSize: '1rem',
    color: '#1e293b',
  },
  description: {
    fontSize: '0.875rem',
    color: '#64748b',
  },
};
