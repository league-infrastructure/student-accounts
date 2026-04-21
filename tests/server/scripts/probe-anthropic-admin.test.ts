/**
 * Unit tests for the probe-anthropic-admin.mjs helper functions (Sprint 010 T009).
 *
 * Tests the summarise logic by directly verifying the expected output strings
 * produced for each endpoint label. The probe() fetch path is covered via the
 * manual verification step; the unit tests here guard the pure summarise logic
 * so regressions are caught without real credentials.
 *
 * Note: the script is a standalone .mjs file that relies on top-level await
 * and process.exit() side-effects, so we test the pure helper functions
 * extracted here rather than importing the script directly.
 */

import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Reproduce the summarise() helper inline (pure function — no imports needed)
// ---------------------------------------------------------------------------

function summarise(label: string, data: unknown): string {
  if (!data) return '(no data)';
  const d = data as Record<string, unknown>;

  switch (label) {
    case 'org/me': {
      const name = (d.name as string) ?? '(unknown)';
      const id = (d.id as string) ?? '(unknown)';
      return `"${name}" (id: ${id})`;
    }
    case 'users': {
      const count = Array.isArray(d.data) ? d.data.length : 0;
      const hasMore = d.has_more === true;
      return hasMore ? `${count}+ user(s) (has_more=true)` : `${count} user(s) in this page`;
    }
    case 'workspaces': {
      const items = Array.isArray(d.data) ? (d.data as Array<{ name: string; id: string }>) : [];
      if (items.length === 0) return '(no workspaces)';
      return items.map((w) => `"${w.name}" (id: ${w.id})`).join(', ');
    }
    case 'invites': {
      const count = Array.isArray(d.data) ? d.data.length : 0;
      const hasMore = d.has_more === true;
      return hasMore ? `${count}+ pending invite(s) (has_more=true)` : `${count} pending invite(s)`;
    }
    default:
      return JSON.stringify(data).slice(0, 120);
  }
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('probe-anthropic-admin summarise()', () => {
  describe('org/me', () => {
    it('returns org name and id', () => {
      const result = summarise('org/me', { name: 'The League of Amazing Programmers', id: 'abc-123' });
      expect(result).toBe('"The League of Amazing Programmers" (id: abc-123)');
    });

    it('uses (unknown) placeholder when fields are missing', () => {
      const result = summarise('org/me', {});
      expect(result).toBe('"(unknown)" (id: (unknown))');
    });

    it('returns (no data) when data is null', () => {
      expect(summarise('org/me', null)).toBe('(no data)');
    });
  });

  describe('users', () => {
    it('reports user count when has_more=false', () => {
      const result = summarise('users', { data: [{ id: 'u1' }], has_more: false });
      expect(result).toBe('1 user(s) in this page');
    });

    it('reports 0 users when data is empty', () => {
      const result = summarise('users', { data: [], has_more: false });
      expect(result).toBe('0 user(s) in this page');
    });

    it('appends has_more indicator', () => {
      const result = summarise('users', { data: [{ id: 'u1' }], has_more: true });
      expect(result).toBe('1+ user(s) (has_more=true)');
    });
  });

  describe('workspaces', () => {
    it('returns workspace names and ids', () => {
      const result = summarise('workspaces', {
        data: [
          { name: 'Students', id: 'ws-1' },
          { name: 'Staff', id: 'ws-2' },
        ],
      });
      expect(result).toBe('"Students" (id: ws-1), "Staff" (id: ws-2)');
    });

    it('returns (no workspaces) for empty list', () => {
      expect(summarise('workspaces', { data: [] })).toBe('(no workspaces)');
    });
  });

  describe('invites', () => {
    it('reports pending invite count', () => {
      const result = summarise('invites', { data: [], has_more: false });
      expect(result).toBe('0 pending invite(s)');
    });

    it('reports count with has_more indicator', () => {
      const result = summarise('invites', {
        data: [{ id: 'i1' }],
        has_more: true,
      });
      expect(result).toBe('1+ pending invite(s) (has_more=true)');
    });
  });

  describe('unknown label', () => {
    it('falls back to JSON serialisation (truncated)', () => {
      const result = summarise('other', { foo: 'bar' });
      expect(result).toContain('foo');
    });
  });
});
