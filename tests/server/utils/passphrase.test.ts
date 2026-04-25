/**
 * Unit tests for passphrase utilities.
 *
 * Tests:
 *  - generatePassphrase returns a valid-shaped passphrase
 *  - All tokens in a generated passphrase are members of PASSPHRASE_WORDS
 *  - No duplicate tokens within a single generated phrase (N=200 trials)
 *  - 4-word variant generates exactly 4 tokens
 *  - validatePassphraseShape accepts valid phrases
 *  - validatePassphraseShape rejects various invalid inputs
 */

import { PASSPHRASE_WORDS } from '../../../server/src/utils/passphrase-words.js';
import {
  generatePassphrase,
  validatePassphraseShape,
} from '../../../server/src/utils/passphrase.js';

// ---------------------------------------------------------------------------
// generatePassphrase
// ---------------------------------------------------------------------------

describe('generatePassphrase', () => {
  it('returns a hyphen-joined lowercase string', () => {
    const phrase = generatePassphrase();
    expect(phrase).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
  });

  it('defaults to 3 tokens', () => {
    const phrase = generatePassphrase();
    expect(phrase.split('-').length).toBe(3);
  });

  it('generates 4 tokens when words=4', () => {
    const phrase = generatePassphrase(4);
    expect(phrase.split('-').length).toBe(4);
  });

  it('every token in a generated phrase is a member of PASSPHRASE_WORDS', () => {
    const wordSet = new Set(PASSPHRASE_WORDS);
    const phrase = generatePassphrase();
    const tokens = phrase.split('-');
    for (const token of tokens) {
      expect(wordSet.has(token)).toBe(true);
    }
  });

  it('does not repeat tokens within a single 3-word phrase across 200 trials', () => {
    for (let i = 0; i < 200; i++) {
      const tokens = generatePassphrase(3).split('-');
      const unique = new Set(tokens);
      expect(unique.size).toBe(3);
    }
  });

  it('does not repeat tokens within a single 4-word phrase across 200 trials', () => {
    for (let i = 0; i < 200; i++) {
      const tokens = generatePassphrase(4).split('-');
      const unique = new Set(tokens);
      expect(unique.size).toBe(4);
    }
  });

  it('generated phrase passes validatePassphraseShape', () => {
    for (let i = 0; i < 50; i++) {
      expect(validatePassphraseShape(generatePassphrase())).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// validatePassphraseShape
// ---------------------------------------------------------------------------

describe('validatePassphraseShape', () => {
  // Build valid 2- and 3-word phrases from known words for positive tests
  const [w1, w2, w3] = PASSPHRASE_WORDS;

  it('accepts a valid 2-word phrase', () => {
    expect(validatePassphraseShape(`${w1}-${w2}`)).toBe(true);
  });

  it('accepts a valid 3-word phrase', () => {
    expect(validatePassphraseShape(`${w1}-${w2}-${w3}`)).toBe(true);
  });

  it('accepts a valid 4-word phrase', () => {
    const w4 = PASSPHRASE_WORDS[3];
    expect(validatePassphraseShape(`${w1}-${w2}-${w3}-${w4}`)).toBe(true);
  });

  it('rejects an empty string', () => {
    expect(validatePassphraseShape('')).toBe(false);
  });

  it('rejects a single word (no hyphen)', () => {
    expect(validatePassphraseShape(w1)).toBe(false);
  });

  it('rejects a phrase with too many words (5)', () => {
    const [a, b, c, d, e] = PASSPHRASE_WORDS;
    expect(validatePassphraseShape(`${a}-${b}-${c}-${d}-${e}`)).toBe(false);
  });

  it('rejects a phrase with leading hyphen', () => {
    expect(validatePassphraseShape(`-${w1}-${w2}`)).toBe(false);
  });

  it('rejects a phrase with trailing hyphen', () => {
    expect(validatePassphraseShape(`${w1}-${w2}-`)).toBe(false);
  });

  it('rejects tokens with uppercase letters', () => {
    expect(validatePassphraseShape('Apple-bear-cat')).toBe(false);
  });

  it('rejects tokens not in PASSPHRASE_WORDS', () => {
    expect(validatePassphraseShape('xyz-abc-qrs')).toBe(false);
  });

  it('rejects tokens containing numbers', () => {
    expect(validatePassphraseShape('cat1-dog2-fox3')).toBe(false);
  });

  it('rejects a phrase with non-ASCII characters', () => {
    expect(validatePassphraseShape('café-bear-cat')).toBe(false);
  });
});
