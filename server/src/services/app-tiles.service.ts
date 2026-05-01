/**
 * app-tiles.service.ts — Sprint 016.
 *
 * Pure function: given a user's role and LLM proxy grant status, compute
 * the list of application tiles they should see on the universal dashboard.
 *
 * No I/O, no Prisma, no Express. Safe to unit-test in isolation.
 */

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AppTile {
  id: string;
  title: string;
  description: string;
  href: string;
  icon: string;
}

export interface ComputeAppTilesInput {
  role: 'student' | 'staff' | 'admin';
  llmProxyEnabled: boolean;
}

// ---------------------------------------------------------------------------
// Tile catalog
// ---------------------------------------------------------------------------

const TILE_USER_MANAGEMENT: AppTile = {
  id: 'user-management',
  title: 'User Management',
  description: 'Manage student, staff, and admin accounts',
  href: '/admin/users',
  icon: 'users',
};

const TILE_STAFF_DIRECTORY: AppTile = {
  id: 'staff-directory',
  title: 'Staff Directory',
  description: 'Look up League staff',
  href: '/staff/directory',
  icon: 'directory',
};

const TILE_LLM_PROXY: AppTile = {
  id: 'llm-proxy',
  title: 'LLM Proxy',
  description: 'Use Claude through your League proxy token',
  href: '/account#llm-proxy',
  icon: 'bot',
};

const TILE_COHORTS: AppTile = {
  id: 'cohorts',
  title: 'Cohorts',
  description: 'Manage class cohorts',
  href: '/admin/cohorts',
  icon: 'cohort',
};

const TILE_GROUPS: AppTile = {
  id: 'groups',
  title: 'Groups',
  description: 'Manage student groups',
  href: '/admin/groups',
  icon: 'group',
};

// Sprint 018 — OAuth application registry (admin-only).
const TILE_OAUTH_CLIENTS: AppTile = {
  id: 'oauth-clients',
  title: 'OAuth Clients',
  description: 'Register and manage OAuth application credentials',
  href: '/admin/oauth-clients',
  icon: 'key',
};

// ---------------------------------------------------------------------------
// Tile computation
// ---------------------------------------------------------------------------

/**
 * Compute the tile list for a user based on their role and LLM proxy status.
 *
 * Entitlement rules:
 *  - user-management: staff and admin
 *  - staff-directory:  staff and admin
 *  - llm-proxy:        student only, when llmProxyEnabled === true
 *  - cohorts:          admin only
 *  - groups:           admin only
 */
export function computeAppTiles({ role, llmProxyEnabled }: ComputeAppTilesInput): AppTile[] {
  const tiles: AppTile[] = [];

  if (role === 'staff' || role === 'admin') {
    tiles.push(TILE_USER_MANAGEMENT);
    tiles.push(TILE_STAFF_DIRECTORY);
  }

  if (role === 'student' && llmProxyEnabled) {
    tiles.push(TILE_LLM_PROXY);
  }

  if (role === 'admin') {
    tiles.push(TILE_COHORTS);
    tiles.push(TILE_GROUPS);
    tiles.push(TILE_OAUTH_CLIENTS);
  }

  return tiles;
}
