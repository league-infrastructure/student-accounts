/**
 * Unit tests for the prettifyName utility (Sprint 009 T006).
 *
 * No DOM rendering required — pure function tests.
 */

import { describe, it, expect } from 'vitest';
import { prettifyName } from '../../client/src/pages/admin/utils/prettifyName';

describe('prettifyName', () => {
  it('converts first.last@jointheleague.org to Title Case full name', () => {
    expect(prettifyName({ email: 'eric.busboom@jointheleague.org', displayName: null })).toBe(
      'Eric Busboom',
    );
  });

  it('works for a single-character first name that is still all lowercase', () => {
    expect(prettifyName({ email: 'alice.smith@jointheleague.org', displayName: null })).toBe(
      'Alice Smith',
    );
  });

  it('ignores displayName for @jointheleague.org first.last addresses', () => {
    expect(
      prettifyName({ email: 'jane.doe@jointheleague.org', displayName: 'Some Display Name' }),
    ).toBe('Jane Doe');
  });

  it('falls back to displayName for non-matching @jointheleague.org local part', () => {
    // Local part has uppercase — does not match ^[a-z]+\.[a-z]+$
    expect(
      prettifyName({ email: 'JaneDoe@jointheleague.org', displayName: 'Jane Doe' }),
    ).toBe('Jane Doe');
  });

  it('falls back to displayName for @jointheleague.org local with no dot', () => {
    expect(
      prettifyName({ email: 'janedoe@jointheleague.org', displayName: 'Jane Doe' }),
    ).toBe('Jane Doe');
  });

  it('falls back to displayName for non-league email', () => {
    expect(
      prettifyName({ email: 'user@example.com', displayName: 'Regular User' }),
    ).toBe('Regular User');
  });

  it('falls back to email local part when displayName is null and email is non-league', () => {
    expect(prettifyName({ email: 'someone@example.com', displayName: null })).toBe('someone');
  });

  it('falls back to email local part when displayName is null and local part does not match pattern', () => {
    expect(prettifyName({ email: 'noDot@jointheleague.org', displayName: null })).toBe('noDot');
  });

  it('handles hyphenated local parts as non-matching (dash is not a letter)', () => {
    expect(
      prettifyName({ email: 'jane-doe@jointheleague.org', displayName: 'Jane Doe' }),
    ).toBe('Jane Doe');
  });
});
