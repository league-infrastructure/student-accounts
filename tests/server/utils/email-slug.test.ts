/**
 * Unit tests for email-slug utilities (Sprint 004, T004).
 *
 * Covers:
 *  - displayNameToSlug — standard cases
 *  - displayNameToSlug — spaces become dots
 *  - displayNameToSlug — special/unicode characters stripped or transliterated
 *  - displayNameToSlug — very long name truncated
 *  - displayNameToSlug — single word (no dot)
 *  - displayNameToSlug — empty / very short → fallback
 *  - splitDisplayName — first/rest split
 *  - splitDisplayName — single word → given=family
 *  - splitDisplayName — empty → defaults
 */

import { displayNameToSlug, splitDisplayName } from '../../../server/src/utils/email-slug.js';

// ---------------------------------------------------------------------------
// displayNameToSlug
// ---------------------------------------------------------------------------

describe('displayNameToSlug', () => {
  it('converts a standard first last name to firstname.lastname', () => {
    expect(displayNameToSlug('Alice Smith', 1)).toBe('alice.smith');
  });

  it('replaces spaces with dots', () => {
    expect(displayNameToSlug('John Doe', 2)).toBe('john.doe');
  });

  it('lowercases the result', () => {
    expect(displayNameToSlug('ALICE SMITH', 3)).toBe('alice.smith');
  });

  it('handles a three-part name', () => {
    expect(displayNameToSlug('Mary Jane Watson', 4)).toBe('mary.jane.watson');
  });

  it('strips accents via unicode normalization (é → e)', () => {
    expect(displayNameToSlug('José García', 5)).toBe('jose.garcia');
  });

  it('strips non-alphanumeric characters (apostrophe)', () => {
    // "O'Brien" → o.brien (apostrophe stripped)
    const result = displayNameToSlug("O'Brien", 6);
    expect(result).toMatch(/^o[.\-]?brien$|^obrien$/);
  });

  it('collapses consecutive separators into a single dot', () => {
    // Multiple spaces between words
    const result = displayNameToSlug('Alice   Smith', 7);
    expect(result).toBe('alice.smith');
  });

  it('strips leading and trailing dots', () => {
    // Edge case: display_name that starts or ends with a space
    const result = displayNameToSlug('  Alice  ', 8);
    expect(result).toBe('alice');
  });

  it('truncates a very long name to MAX_SLUG_LENGTH (30 chars) at a dot boundary', () => {
    const longName = 'Alexandrina Konstantinopoulou Papadopoulos';
    const result = displayNameToSlug(longName, 9);
    expect(result.length).toBeLessThanOrEqual(30);
    // Should not end with a dot
    expect(result).not.toMatch(/\.$/);
  });

  it('handles a single-word display name with no dot', () => {
    expect(displayNameToSlug('Alice', 10)).toBe('alice');
  });

  it('returns user<id> for an empty display name', () => {
    expect(displayNameToSlug('', 11)).toBe('user11');
  });

  it('returns user<id> for a whitespace-only display name', () => {
    expect(displayNameToSlug('   ', 12)).toBe('user12');
  });

  it('returns user<id> when slug would be shorter than MIN_SLUG_LENGTH (3)', () => {
    // Single character name
    expect(displayNameToSlug('A', 13)).toBe('user13');
    // Two characters
    expect(displayNameToSlug('Jo', 14)).toBe('user14');
  });

  it('preserves hyphens in the slug', () => {
    // Mary-Jane → mary-jane
    const result = displayNameToSlug('Mary-Jane', 15);
    expect(result).toBe('mary-jane');
  });

  it('strips characters that would be invalid email local-part chars', () => {
    // '@', '!', etc. are stripped. No spaces means no dots introduced.
    // 'Alice@Smith!' → 'alicesmith' (@ and ! stripped, no spaces)
    const result = displayNameToSlug('Alice@Smith!', 16);
    expect(result).toBe('alicesmith');
  });

  it('handles unicode emoji or CJK characters gracefully (stripped)', () => {
    // CJK characters decompose to their base form or are stripped
    const result = displayNameToSlug('Zhang Wei 张伟', 17);
    // Chinese characters are stripped; latin part remains
    expect(result).toMatch(/^zhang\.wei/);
    // No non-ascii characters in result
    expect(result).toMatch(/^[a-z0-9.\-]+$/);
  });

  it('uses the fallback id correctly in the fallback slug', () => {
    expect(displayNameToSlug('', 999)).toBe('user999');
  });
});

// ---------------------------------------------------------------------------
// splitDisplayName
// ---------------------------------------------------------------------------

describe('splitDisplayName', () => {
  it('splits "Alice Smith" into given=Alice, family=Smith', () => {
    expect(splitDisplayName('Alice Smith')).toEqual({
      givenName: 'Alice',
      familyName: 'Smith',
    });
  });

  it('splits three-part name: given=first word, family=rest', () => {
    expect(splitDisplayName('Mary Jane Watson')).toEqual({
      givenName: 'Mary',
      familyName: 'Jane Watson',
    });
  });

  it('returns given=family for a single word', () => {
    expect(splitDisplayName('Alice')).toEqual({
      givenName: 'Alice',
      familyName: 'Alice',
    });
  });

  it('returns defaults for an empty string', () => {
    expect(splitDisplayName('')).toEqual({
      givenName: 'Student',
      familyName: 'User',
    });
  });

  it('returns defaults for whitespace-only input', () => {
    expect(splitDisplayName('   ')).toEqual({
      givenName: 'Student',
      familyName: 'User',
    });
  });

  it('trims leading/trailing whitespace before splitting', () => {
    expect(splitDisplayName('  Alice Smith  ')).toEqual({
      givenName: 'Alice',
      familyName: 'Smith',
    });
  });
});
