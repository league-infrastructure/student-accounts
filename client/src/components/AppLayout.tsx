import { useState, useRef, useEffect } from 'react';
import { NavLink, Navigate, Outlet, useNavigate, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { hasAdminAccess, hasStaffAccess, roleShortLabel, roleBadgeStyle } from '../lib/roles';
import { useAdminEventStream } from '../hooks/useAdminEventStream';
import type { AccountData } from '../pages/Account';

/* ------------------------------------------------------------------ */
/*  Navigation data                                                    */
/* ------------------------------------------------------------------ */

/**
 * Fetch the current user's account data from the API.
 * Shared with Account.tsx via the ['account'] React Query cache key.
 */
async function fetchAccount(): Promise<AccountData> {
  const res = await fetch('/api/account');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(
      (body as { error?: string }).error ?? `Failed to load account (${res.status})`,
    );
  }
  return res.json() as Promise<AccountData>;
}

type SidebarLinkItem = {
  kind: 'link';
  to: string;
  label: string;
  end?: boolean;
  gate?: (role: string | undefined, account: AccountData | undefined) => boolean;
};

type SidebarGroupChild = {
  to: string;
  label: string;
  end?: boolean;
  gate?: (role: string | undefined) => boolean;
};

type SidebarGroupItem = {
  kind: 'group';
  label: string;
  /** Navigated to when the group header is clicked. */
  defaultTo: string;
  gate?: (role: string | undefined) => boolean;
  children: SidebarGroupChild[];
};

type SidebarItem = SidebarLinkItem | SidebarGroupItem;

/**
 * Single authoritative nav config.
 *
 * Flat link items use an optional gate(role, account) predicate.
 * Group items use an optional gate(role) predicate; children may have
 * their own gate(role) predicate to filter individual items.
 *
 * The sidebar is identical regardless of the current URL — the old
 * isAdminSection morph branch has been removed.
 */
const SIDEBAR_NAV: SidebarItem[] = [
  // --- Always-on for authenticated users ---
  {
    kind: 'link',
    to: '/account',
    label: 'Account',
  },
  // --- Dashboard (admin only) — second item for admins ---
  {
    kind: 'link',
    to: '/',
    label: 'Dashboard',
    end: true,
    gate: (role) => hasAdminAccess(role),
  },
  {
    kind: 'link',
    to: '/oauth-clients',
    label: 'OAuth Clients',
  },

  // --- Entitlement-gated items (require account data) ---
  {
    kind: 'link',
    to: '/claude-code',
    label: 'Claude Code',
    gate: (_role, account) =>
      account?.externalAccounts.some((ea) => ea.type === 'claude') ?? false,
  },
  {
    kind: 'link',
    to: '/llm-proxy',
    label: 'LLM Proxy',
    gate: (_role, account) => account?.profile.llmProxyEnabled === true,
  },

  // --- User Management group (staff + admin) ---
  {
    kind: 'group',
    label: 'User Management',
    defaultTo: '/staff/directory',
    gate: hasStaffAccess,
    children: [
      { to: '/staff/directory', label: 'Staff Directory', gate: hasStaffAccess },
      { to: '/admin/users', label: 'Users', gate: hasAdminAccess },
      { to: '/users/students', label: 'League Students', gate: hasAdminAccess },
      { to: '/users/llm-proxy', label: 'LLM Proxy Users', gate: hasAdminAccess },
      { to: '/cohorts', label: 'Cohorts', gate: hasAdminAccess },
      { to: '/groups', label: 'Groups', gate: hasAdminAccess },
    ],
  },

  // --- Admin-only flat items ---
  {
    kind: 'link',
    to: '/sync',
    label: 'Sync',
    gate: (role) => hasAdminAccess(role),
  },

  // --- Admin ops group ---
  {
    kind: 'group',
    label: 'Admin',
    defaultTo: '/admin/audit-log',
    gate: hasAdminAccess,
    children: [
      { to: '/admin/audit-log', label: 'Audit Log' },
      { to: '/admin/env', label: 'Environment' },
      { to: '/admin/db', label: 'Database' },
      { to: '/admin/config', label: 'Configuration' },
      { to: '/admin/logs', label: 'Logs' },
      { to: '/admin/sessions', label: 'Sessions' },
      { to: '/admin/scheduler', label: 'Scheduled Jobs' },
      { to: '/admin/import-export', label: 'Import/Export' },
    ],
  },
];

const BOTTOM_NAV = [{ to: '/about', label: 'About' }];

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const SIDEBAR_WIDTH = 240;
const TOPBAR_HEIGHT = 52;

const styles = {
  wrapper: {
    display: 'flex',
    minHeight: '100vh',
  } as const,

  sidebar: (open: boolean) =>
    ({
      position: 'fixed' as const,
      top: 0,
      left: 0,
      bottom: 0,
      width: SIDEBAR_WIDTH,
      flexShrink: 0,
      background: '#1a1a2e',
      color: '#eee',
      display: 'flex',
      flexDirection: 'column' as const,
      zIndex: 100,
      transform: open ? 'translateX(0)' : `translateX(-${SIDEBAR_WIDTH}px)`,
      transition: 'transform 0.2s ease',
    }),

  sidebarDesktop: {
    transform: 'translateX(0)',
  } as const,

  overlay: {
    position: 'fixed' as const,
    inset: 0,
    background: 'rgba(0,0,0,0.4)',
    zIndex: 99,
  } as const,

  logo: {
    padding: '16px 16px 12px',
    fontWeight: 700,
    fontSize: 16,
    letterSpacing: '-0.01em',
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    borderBottom: '1px solid #2a2a4e',
  } as const,

  navLink: (isActive: boolean) =>
    ({
      display: 'block',
      padding: '9px 16px',
      color: isActive ? '#fff' : '#aaa',
      background: isActive ? '#16213e' : 'transparent',
      textDecoration: 'none',
      fontSize: 14,
    }),

  groupHeader: (isChildActive: boolean) =>
    ({
      display: 'flex',
      alignItems: 'center',
      padding: '9px 16px',
      color: isChildActive ? '#fff' : '#aaa',
      background: isChildActive ? '#16213e' : 'transparent',
      fontSize: 14,
      cursor: 'pointer',
      userSelect: 'none' as const,
      gap: 6,
    }),

  groupChevron: (expanded: boolean) =>
    ({
      fontSize: 10,
      transform: expanded ? 'rotate(90deg)' : 'rotate(0deg)',
      transition: 'transform 0.15s ease',
      flexShrink: 0,
    }),

  groupChild: (isActive: boolean) =>
    ({
      display: 'block',
      padding: '7px 16px 7px 28px',
      color: isActive ? '#fff' : '#aaa',
      background: isActive ? '#16213e' : 'transparent',
      textDecoration: 'none',
      fontSize: 13,
    }),

  topbar: {
    position: 'fixed' as const,
    top: 0,
    right: 0,
    height: TOPBAR_HEIGHT,
    background: '#fff',
    borderBottom: '1px solid #e2e8f0',
    display: 'flex',
    alignItems: 'center',
    padding: '0 16px',
    gap: 12,
    zIndex: 50,
  } as const,

  hamburger: {
    background: 'none',
    border: 'none',
    fontSize: 22,
    cursor: 'pointer',
    padding: '4px 8px',
    color: '#333',
    lineHeight: 1,
  } as const,

  userArea: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    padding: '4px 8px',
    borderRadius: 6,
    userSelect: 'none' as const,
  } as const,

  avatar: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    objectFit: 'cover' as const,
  } as const,

  avatarFallback: {
    width: 28,
    height: 28,
    borderRadius: '50%',
    background: '#4f46e5',
    color: '#fff',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: 13,
    fontWeight: 600,
    flexShrink: 0,
  } as const,

  roleBadge: (bg: string, fg: string) =>
    ({
      fontSize: 11,
      padding: '2px 7px',
      borderRadius: 9999,
      fontWeight: 600,
      background: bg,
      color: fg,
    }),

  dropdown: {
    position: 'absolute' as const,
    top: '100%',
    right: 0,
    marginTop: 4,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
    minWidth: 140,
    zIndex: 200,
    overflow: 'hidden',
  } as const,

  dropdownItem: {
    display: 'block',
    width: '100%',
    padding: '8px 14px',
    background: 'none',
    border: 'none',
    textAlign: 'left' as const,
    fontSize: 14,
    cursor: 'pointer',
    color: '#333',
  } as const,

  content: {
    flex: 1,
    padding: 24,
    minWidth: 0,
    overflow: 'auto',
  } as const,

  impersonationBanner: {
    background: '#f59e0b',
    color: '#1c1917',
    padding: '8px 16px',
    fontSize: 13,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  } as const,

  sidebarUserArea: {
    position: 'relative' as const,
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    cursor: 'pointer',
    padding: '10px 16px',
    borderTop: '1px solid #2a2a4e',
    userSelect: 'none' as const,
  } as const,

  sidebarUserName: {
    flex: 1,
    fontSize: 14,
    fontWeight: 500,
    color: '#eee',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  } as const,

  sidebarDropdown: {
    position: 'absolute' as const,
    bottom: '100%',
    left: 8,
    right: 8,
    marginBottom: 4,
    background: '#fff',
    border: '1px solid #e2e8f0',
    borderRadius: 6,
    boxShadow: '0 -4px 12px rgba(0,0,0,0.2)',
    zIndex: 200,
    overflow: 'hidden',
  } as const,
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

const MOBILE_BREAKPOINT = 768;

function useIsMobile() {
  const [mobile, setMobile] = useState(
    typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false,
  );

  useEffect(() => {
    function onResize() {
      setMobile(window.innerWidth < MOBILE_BREAKPOINT);
    }
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  return mobile;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function AppLayout() {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [appName, setAppName] = useState(import.meta.env.VITE_APP_NAME ?? 'Template App');
  // Per-group expand/collapse state, keyed by group label.
  const [groupExpanded, setGroupExpanded] = useState<Record<string, boolean>>({});
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Fetch app name from health endpoint
  useEffect(() => {
    fetch('/api/health')
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.appName) setAppName(data.appName);
      })
      .catch(() => {});
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  // Fetch account data for entitlement gates (Claude Code / LLM Proxy).
  // Uses the same ['account'] cache key as Account.tsx to avoid double fetches.
  // Must be called unconditionally before any early return (Rules of Hooks).
  // For non-students /api/account returns 403; the query errors silently and
  // accountData stays undefined, which hides the entitlement-gated items.
  const { data: accountData } = useQuery<AccountData>({
    queryKey: ['account'],
    queryFn: fetchAccount,
    enabled: !loading && !!user,
    retry: false,
  });

  // Redirect to login if not authenticated
  if (loading) {
    return (
      <div
        style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: '100vh' }}
      >
        <p>Loading...</p>
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace />;
  }

  const displayName = user.displayName ?? 'User';
  const role = user.role;
  const badge = roleBadgeStyle(role);
  const isAdmin = hasAdminAccess(role);
  const avatarInitial = displayName.charAt(0).toUpperCase();

  function closeSidebarIfMobile() {
    if (isMobile) setSidebarOpen(false);
  }

  async function handleLogout() {
    setDropdownOpen(false);
    await logout();
    navigate('/login');
  }

  async function handleStopImpersonating() {
    setDropdownOpen(false);
    await fetch('/api/admin/stop-impersonating', { method: 'POST' });
    window.location.reload();
  }

  function isGroupChildActive(children: SidebarGroupChild[]) {
    return children.some(
      (child) =>
        location.pathname === child.to || location.pathname.startsWith(child.to + '/'),
    );
  }

  function handleGroupClick(item: SidebarGroupItem) {
    navigate(item.defaultTo);
    // Accordion behavior: opening a group closes any other open group.
    setGroupExpanded((prev) =>
      prev[item.label] ? {} : { [item.label]: true },
    );
    closeSidebarIfMobile();
  }

  /* ---------- Sidebar ---------- */

  const sidebarStyle = isMobile
    ? styles.sidebar(sidebarOpen)
    : { ...styles.sidebar(true), ...styles.sidebarDesktop };

  const sidebar = (
    <nav style={sidebarStyle}>
      {/* Logo */}
      <div style={styles.logo}>{appName}</div>

      {/* Main nav */}
      <div style={{ flex: 1, overflowY: 'auto', paddingTop: 8 }}>
        {SIDEBAR_NAV.map((item) => {
          if (item.kind === 'link') {
            // Apply gate if present
            if (item.gate && !item.gate(role, accountData)) return null;
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                onClick={closeSidebarIfMobile}
                style={({ isActive }) => styles.navLink(isActive)}
              >
                {item.label}
              </NavLink>
            );
          }

          // Group item
          if (item.gate && !item.gate(role)) return null;

          const visibleChildren = item.children.filter(
            (child) => !child.gate || child.gate(role),
          );
          if (visibleChildren.length === 0) return null;

          const childActive = isGroupChildActive(visibleChildren);
          const expanded = groupExpanded[item.label] ?? childActive;

          return (
            <div key={item.label}>
              <div
                style={styles.groupHeader(childActive)}
                onClick={() => handleGroupClick(item)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    handleGroupClick(item);
                  }
                }}
                aria-expanded={expanded}
              >
                <span style={{ flex: 1 }}>{item.label}</span>
                <span style={styles.groupChevron(expanded)}>&#9654;</span>
              </div>
              {expanded &&
                visibleChildren.map((child) => (
                  <NavLink
                    key={child.to}
                    to={child.to}
                    end={child.end}
                    onClick={closeSidebarIfMobile}
                    style={({ isActive }) => styles.groupChild(isActive)}
                  >
                    {child.label}
                  </NavLink>
                ))}
            </div>
          );
        })}
      </div>

      {/* User area */}
      <div
        ref={dropdownRef}
        style={styles.sidebarUserArea}
        onClick={() => setDropdownOpen((v) => !v)}
      >
        {user.avatarUrl ? (
          <img src={user.avatarUrl} alt={displayName} style={styles.avatar} />
        ) : (
          <div style={styles.avatarFallback}>{avatarInitial}</div>
        )}
        <span style={styles.sidebarUserName}>{displayName}</span>
        <span style={styles.roleBadge(badge.background, badge.color)}>
          {roleShortLabel(role)}
        </span>

        {dropdownOpen && (
          <div style={styles.sidebarDropdown}>
            <button
              style={styles.dropdownItem}
              onClick={(e) => {
                e.stopPropagation();
                setDropdownOpen(false);
                navigate('/account');
              }}
            >
              Account
            </button>
            {user.impersonating ? (
              <button
                style={{ ...styles.dropdownItem, borderTop: '1px solid #e2e8f0', color: '#92400e' }}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleStopImpersonating();
                }}
              >
                Stop impersonating
              </button>
            ) : (
              <button
                style={{ ...styles.dropdownItem, borderTop: '1px solid #e2e8f0' }}
                onClick={(e) => {
                  e.stopPropagation();
                  void handleLogout();
                }}
              >
                Log out
              </button>
            )}
          </div>
        )}
      </div>

      {/* Bottom nav */}
      <div style={{ borderTop: '1px solid #2a2a4e', paddingTop: 4, paddingBottom: 8 }}>
        {BOTTOM_NAV.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            onClick={closeSidebarIfMobile}
            style={({ isActive }) => styles.navLink(isActive)}
          >
            {item.label}
          </NavLink>
        ))}
      </div>
    </nav>
  );

  /* ---------- Topbar ---------- */

  const topbarLeftOffset = isMobile ? 0 : SIDEBAR_WIDTH;

  const topbar = (
    <header style={{ ...styles.topbar, left: topbarLeftOffset }}>
      {isMobile && (
        <button
          style={styles.hamburger}
          onClick={() => setSidebarOpen((v) => !v)}
          aria-label="Toggle sidebar"
        >
          &#9776;
        </button>
      )}
      <div style={{ flex: 1 }} />
    </header>
  );

  /* ---------- Render ---------- */

  return (
    <div style={styles.wrapper}>
      {/* Mount the admin SSE stream once per admin session, regardless
          of which page is active. This is what makes the group / cohort
          detail pages refresh in real time when a student joins via a
          passphrase. The hook is in a child so it's only mounted when
          the user is an admin (hooks themselves can't be conditional). */}
      {isAdmin && <AdminEventStreamMount />}

      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div style={styles.overlay} onClick={() => setSidebarOpen(false)} />
      )}

      {sidebar}

      <div
        style={{
          flex: 1,
          marginLeft: isMobile ? 0 : SIDEBAR_WIDTH,
          paddingTop: TOPBAR_HEIGHT,
        }}
      >
        {topbar}
        {user.impersonating && user.realAdmin && (
          <div style={styles.impersonationBanner}>
            <span>
              Viewing as {user.displayName ?? 'unknown'} — real admin: {user.realAdmin.displayName}
            </span>
          </div>
        )}
        <main style={styles.content}>
          <Outlet />
        </main>
      </div>
    </div>
  );
}

/**
 * Subscribes to /api/admin/events for the lifetime of an admin's
 * session. Lives in its own component so the hook can be mounted
 * conditionally on user role without violating the rules of hooks.
 */
function AdminEventStreamMount() {
  useAdminEventStream();
  return null;
}
