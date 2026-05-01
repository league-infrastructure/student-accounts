/**
 * Unit tests for login-payload.ts — typed accessors over provider_payload and
 * directory_metadata JSON columns (Sprint 017 T005).
 *
 * All tests use in-memory Login objects. No DB access.
 */

import { describe, it, expect } from 'vitest';
import {
  getGoogleGroups,
  getGoogleOu,
  getGitHubLogin,
  getPike13Id,
} from '../../../../server/src/services/auth/login-payload.js';

// ---------------------------------------------------------------------------
// Helpers — build minimal Login objects for testing
// ---------------------------------------------------------------------------

function makeLogin(overrides: Partial<{
  provider: string;
  provider_payload: unknown;
  directory_metadata: unknown;
}> = {}): any {
  return {
    id: 1,
    user_id: 1,
    provider: 'google',
    provider_user_id: 'uid-001',
    provider_email: 'test@example.com',
    provider_username: null,
    provider_payload: null,
    provider_payload_updated_at: null,
    directory_metadata: null,
    created_at: new Date(),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getGoogleGroups
// ---------------------------------------------------------------------------

describe('getGoogleGroups', () => {
  it('returns [] for null login', () => {
    expect(getGoogleGroups(null as any)).toEqual([]);
  });

  it('returns [] for non-google provider', () => {
    const login = makeLogin({ provider: 'github', directory_metadata: {
      ou_path: '/Staff',
      groups: [{ id: 'g1', name: 'Staff', email: 'staff@example.com' }],
    }});
    expect(getGoogleGroups(login)).toEqual([]);
  });

  it('returns [] when directory_metadata is null', () => {
    const login = makeLogin({ provider: 'google', directory_metadata: null });
    expect(getGoogleGroups(login)).toEqual([]);
  });

  it('returns [] when directory_metadata is not an object', () => {
    const login = makeLogin({ provider: 'google', directory_metadata: 'bad-data' });
    expect(getGoogleGroups(login)).toEqual([]);
  });

  it('returns [] when groups field is absent', () => {
    const login = makeLogin({ provider: 'google', directory_metadata: { ou_path: '/Staff' } });
    expect(getGoogleGroups(login)).toEqual([]);
  });

  it('returns [] when groups is not an array', () => {
    const login = makeLogin({ provider: 'google', directory_metadata: { groups: 'invalid' } });
    expect(getGoogleGroups(login)).toEqual([]);
  });

  it('returns typed groups when fully populated', () => {
    const groups = [
      { id: 'grp-1', name: 'Engineering', email: 'eng@jointheleague.org' },
      { id: 'grp-2', name: 'Staff', email: 'staff@jointheleague.org' },
    ];
    const login = makeLogin({ provider: 'google', directory_metadata: { groups } });
    expect(getGoogleGroups(login)).toEqual(groups);
  });

  it('filters out malformed group entries', () => {
    const login = makeLogin({
      provider: 'google',
      directory_metadata: {
        groups: [
          { id: 'ok', name: 'Valid', email: 'v@e.com' },
          { id: 123, name: 'BadId' },      // id not a string
          null,                            // null entry
          'string-entry',                  // wrong type
          { id: 'ok2', name: 'Valid2', email: 'v2@e.com' },
        ],
      },
    });
    const result = getGoogleGroups(login);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe('ok');
    expect(result[1].id).toBe('ok2');
  });
});

// ---------------------------------------------------------------------------
// getGoogleOu
// ---------------------------------------------------------------------------

describe('getGoogleOu', () => {
  it('returns null for null login', () => {
    expect(getGoogleOu(null as any)).toBeNull();
  });

  it('returns null for non-google provider', () => {
    const login = makeLogin({ provider: 'github', directory_metadata: { ou_path: '/Staff' } });
    expect(getGoogleOu(login)).toBeNull();
  });

  it('returns null when directory_metadata is null', () => {
    const login = makeLogin({ provider: 'google', directory_metadata: null });
    expect(getGoogleOu(login)).toBeNull();
  });

  it('returns null when directory_metadata is not an object', () => {
    const login = makeLogin({ provider: 'google', directory_metadata: 42 });
    expect(getGoogleOu(login)).toBeNull();
  });

  it('returns null when ou_path is absent', () => {
    const login = makeLogin({ provider: 'google', directory_metadata: { groups: [] } });
    expect(getGoogleOu(login)).toBeNull();
  });

  it('returns null when ou_path is not a string', () => {
    const login = makeLogin({ provider: 'google', directory_metadata: { ou_path: 123 } });
    expect(getGoogleOu(login)).toBeNull();
  });

  it('returns null when ou_path is explicitly null', () => {
    const login = makeLogin({ provider: 'google', directory_metadata: { ou_path: null } });
    expect(getGoogleOu(login)).toBeNull();
  });

  it('returns the ou_path when present', () => {
    const login = makeLogin({ provider: 'google', directory_metadata: { ou_path: '/League Staff/Eng' } });
    expect(getGoogleOu(login)).toBe('/League Staff/Eng');
  });
});

// ---------------------------------------------------------------------------
// getGitHubLogin
// ---------------------------------------------------------------------------

describe('getGitHubLogin', () => {
  it('returns null for null login', () => {
    expect(getGitHubLogin(null as any)).toBeNull();
  });

  it('returns null for non-github provider', () => {
    const login = makeLogin({ provider: 'google', provider_payload: { login: 'octocat' } });
    expect(getGitHubLogin(login)).toBeNull();
  });

  it('returns null when provider_payload is null', () => {
    const login = makeLogin({ provider: 'github', provider_payload: null });
    expect(getGitHubLogin(login)).toBeNull();
  });

  it('returns null when provider_payload is not an object', () => {
    const login = makeLogin({ provider: 'github', provider_payload: 'bad' });
    expect(getGitHubLogin(login)).toBeNull();
  });

  it('returns null when login field is absent', () => {
    const login = makeLogin({ provider: 'github', provider_payload: { id: '12345' } });
    expect(getGitHubLogin(login)).toBeNull();
  });

  it('returns null when login field is not a string', () => {
    const login = makeLogin({ provider: 'github', provider_payload: { login: 42 } });
    expect(getGitHubLogin(login)).toBeNull();
  });

  it('returns the GitHub username when present', () => {
    const login = makeLogin({ provider: 'github', provider_payload: { login: 'octocat', id: '1234' } });
    expect(getGitHubLogin(login)).toBe('octocat');
  });
});

// ---------------------------------------------------------------------------
// getPike13Id
// ---------------------------------------------------------------------------

describe('getPike13Id', () => {
  it('returns null for null login', () => {
    expect(getPike13Id(null as any)).toBeNull();
  });

  it('returns null for non-pike13 provider', () => {
    const login = makeLogin({ provider: 'google', provider_payload: { id: '9999' } });
    expect(getPike13Id(login)).toBeNull();
  });

  it('returns null when provider_payload is null', () => {
    const login = makeLogin({ provider: 'pike13', provider_payload: null });
    expect(getPike13Id(login)).toBeNull();
  });

  it('returns null when provider_payload is not an object', () => {
    const login = makeLogin({ provider: 'pike13', provider_payload: 'bad' });
    expect(getPike13Id(login)).toBeNull();
  });

  it('returns null when id field is absent', () => {
    const login = makeLogin({ provider: 'pike13', provider_payload: { email: 'user@pike13.com' } });
    expect(getPike13Id(login)).toBeNull();
  });

  it('returns null when id is not a string', () => {
    const login = makeLogin({ provider: 'pike13', provider_payload: { id: 12345 } });
    expect(getPike13Id(login)).toBeNull();
  });

  it('returns the Pike13 person id when present as a string', () => {
    const login = makeLogin({ provider: 'pike13', provider_payload: { id: '54321', email: 'u@pike13.com' } });
    expect(getPike13Id(login)).toBe('54321');
  });
});
