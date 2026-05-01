/**
 * Unit tests for app-tiles.service.ts — Sprint 016 ticket 001.
 *
 * computeAppTiles is a pure function with no I/O, so these tests run
 * entirely in memory without any database.
 */

import { computeAppTiles } from '../../../server/src/services/app-tiles.service.js';

describe('computeAppTiles', () => {
  // -------------------------------------------------------------------------
  // Student without LLM token
  // -------------------------------------------------------------------------
  it('returns no tiles for a student without an LLM proxy token', () => {
    const tiles = computeAppTiles({ role: 'student', llmProxyEnabled: false });
    expect(tiles).toHaveLength(0);
  });

  // -------------------------------------------------------------------------
  // Student with LLM token
  // -------------------------------------------------------------------------
  it('returns the llm-proxy tile for a student with an active token', () => {
    const tiles = computeAppTiles({ role: 'student', llmProxyEnabled: true });
    expect(tiles).toHaveLength(1);
    expect(tiles[0].id).toBe('llm-proxy');
  });

  it('does not return user-management or staff tiles for a student', () => {
    const tiles = computeAppTiles({ role: 'student', llmProxyEnabled: true });
    const ids = tiles.map((t) => t.id);
    expect(ids).not.toContain('user-management');
    expect(ids).not.toContain('staff-directory');
    expect(ids).not.toContain('cohorts');
    expect(ids).not.toContain('groups');
  });

  // -------------------------------------------------------------------------
  // Staff
  // -------------------------------------------------------------------------
  it('returns user-management and staff-directory for staff', () => {
    const tiles = computeAppTiles({ role: 'staff', llmProxyEnabled: false });
    const ids = tiles.map((t) => t.id);
    expect(ids).toContain('user-management');
    expect(ids).toContain('staff-directory');
  });

  it('does not return cohorts, groups, or llm-proxy for staff', () => {
    const tiles = computeAppTiles({ role: 'staff', llmProxyEnabled: false });
    const ids = tiles.map((t) => t.id);
    expect(ids).not.toContain('cohorts');
    expect(ids).not.toContain('groups');
    expect(ids).not.toContain('llm-proxy');
  });

  // -------------------------------------------------------------------------
  // Admin
  // -------------------------------------------------------------------------
  it('returns user-management, staff-directory, cohorts, and groups for admin', () => {
    const tiles = computeAppTiles({ role: 'admin', llmProxyEnabled: false });
    const ids = tiles.map((t) => t.id);
    expect(ids).toContain('user-management');
    expect(ids).toContain('staff-directory');
    expect(ids).toContain('cohorts');
    expect(ids).toContain('groups');
  });

  it('does not return llm-proxy for admin', () => {
    const tiles = computeAppTiles({ role: 'admin', llmProxyEnabled: false });
    const ids = tiles.map((t) => t.id);
    expect(ids).not.toContain('llm-proxy');
  });

  // -------------------------------------------------------------------------
  // Tile shape
  // -------------------------------------------------------------------------
  it('each tile has the required fields (id, title, description, href, icon)', () => {
    const tiles = computeAppTiles({ role: 'admin', llmProxyEnabled: false });
    for (const tile of tiles) {
      expect(typeof tile.id).toBe('string');
      expect(typeof tile.title).toBe('string');
      expect(typeof tile.description).toBe('string');
      expect(typeof tile.href).toBe('string');
      expect(typeof tile.icon).toBe('string');
    }
  });
});
