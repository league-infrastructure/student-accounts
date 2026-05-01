/**
 * Unit tests for redirect-matcher (Sprint 019 ticket 002).
 *
 * The matcher is a pure function — no DB, no imports to mock.
 * RFC-critical security cases are marked with "[SECURITY]".
 */

import { describe, it, expect } from 'vitest';
import { matchesRedirectUri } from '../../../../server/src/services/oauth/redirect-matcher.js';

// ---------------------------------------------------------------------------
// Exact match
// ---------------------------------------------------------------------------

describe('matchesRedirectUri — exact match', () => {
  it('matches when registered has one entry and candidate equals it', () => {
    expect(matchesRedirectUri(['https://example.com/cb'], 'https://example.com/cb')).toBe(true);
  });

  it('matches when candidate equals one of multiple registered entries', () => {
    expect(
      matchesRedirectUri(
        ['https://example.com/cb', 'https://other.com/cb2'],
        'https://other.com/cb2',
      ),
    ).toBe(true);
  });

  it('returns false when registered is empty', () => {
    expect(matchesRedirectUri([], 'https://example.com/cb')).toBe(false);
  });

  it('returns false when candidate does not match any registration (different path)', () => {
    expect(matchesRedirectUri(['https://example.com/cb'], 'https://example.com/other')).toBe(false);
  });

  it('returns false when candidate does not match any registration (different host)', () => {
    expect(matchesRedirectUri(['https://example.com/cb'], 'https://other.com/cb')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Localhost any-port matching
// ---------------------------------------------------------------------------

describe('matchesRedirectUri — localhost any-port', () => {
  it('localhost: different port matches same path', () => {
    expect(
      matchesRedirectUri(['http://localhost:8080/cb'], 'http://localhost:5555/cb'),
    ).toBe(true);
  });

  it('[SECURITY] 127.0.0.1 candidate matches localhost registration (cross loopback)', () => {
    expect(
      matchesRedirectUri(['http://localhost:8080/cb'], 'http://127.0.0.1:9000/cb'),
    ).toBe(true);
  });

  it('[SECURITY] IPv6 loopback [::1] candidate matches localhost registration', () => {
    expect(
      matchesRedirectUri(['http://localhost:8080/cb'], 'http://[::1]:5555/cb'),
    ).toBe(true);
  });

  it('path mismatch on localhost returns false', () => {
    expect(
      matchesRedirectUri(['http://localhost:8080/cb'], 'http://localhost:5555/other'),
    ).toBe(false);
  });

  it('[SECURITY] scheme mismatch on localhost returns false (https vs http)', () => {
    expect(
      matchesRedirectUri(['http://localhost:8080/cb'], 'https://localhost:5555/cb'),
    ).toBe(false);
  });

  it('non-localhost different port returns false', () => {
    expect(
      matchesRedirectUri(['https://example.com/cb'], 'https://example.com:5555/cb'),
    ).toBe(false);
  });

  it('trailing-slash path difference returns false', () => {
    expect(
      matchesRedirectUri(['http://localhost:8080/cb'], 'http://localhost:5555/cb/'),
    ).toBe(false);
  });

  it('query string on candidate is ignored — path still matches', () => {
    // Query strings on the candidate should not break path matching.
    // The pathname check compares url.pathname which does NOT include query.
    expect(
      matchesRedirectUri(
        ['http://localhost:8080/cb'],
        'http://localhost:5555/cb?foo=bar',
      ),
    ).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Security attack vectors
// ---------------------------------------------------------------------------

describe('matchesRedirectUri — security attack vectors', () => {
  it('[SECURITY] localhostfake.com does not match localhost registration', () => {
    expect(
      matchesRedirectUri(['http://localhost:8080/cb'], 'http://localhostfake.com/cb'),
    ).toBe(false);
  });

  it('[SECURITY] localhost.evil.com does not match localhost registration', () => {
    expect(
      matchesRedirectUri(['http://localhost:8080/cb'], 'http://localhost.evil.com/cb'),
    ).toBe(false);
  });

  it('[SECURITY] evil.com with localhost in fragment does not match', () => {
    expect(
      matchesRedirectUri(['http://localhost:8080/cb'], 'http://evil.com/cb#localhost'),
    ).toBe(false);
  });

  it('[SECURITY] scheme-relative URL is malformed / returns false', () => {
    // "//evil.com/cb" is not a valid absolute URL → new URL() throws → false
    expect(matchesRedirectUri(['http://localhost:8080/cb'], '//evil.com/cb')).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Edge cases — malformed / empty candidates
// ---------------------------------------------------------------------------

describe('matchesRedirectUri — edge cases', () => {
  it('malformed candidate string returns false (does not throw)', () => {
    expect(matchesRedirectUri(['http://localhost:8080/cb'], 'not a url')).toBe(false);
  });

  it('empty candidate returns false', () => {
    expect(matchesRedirectUri(['http://localhost:8080/cb'], '')).toBe(false);
  });

  it('candidate with just a path returns false (not absolute)', () => {
    expect(matchesRedirectUri(['http://localhost:8080/cb'], '/cb')).toBe(false);
  });
});
