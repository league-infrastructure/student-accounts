/**
 * passphrase.ts — Passphrase generation and validation utilities.
 *
 * No npm dependencies — uses only Node.js built-ins.
 */

import { randomInt } from 'node:crypto';
import { PASSPHRASE_WORDS } from './passphrase-words.js';

/** Set for O(1) membership checks in validatePassphraseShape. */
const WORDS_SET: ReadonlySet<string> = new Set(PASSPHRASE_WORDS);

/**
 * Generate a random hyphen-joined passphrase.
 *
 * Picks N distinct words from PASSPHRASE_WORDS using crypto.randomInt for
 * unbiased selection. Words are sampled without replacement so no word
 * repeats within a single phrase.
 *
 * @param words - Number of words in the phrase (3 or 4). Defaults to 3.
 * @returns A lowercase hyphen-joined passphrase, e.g. "maple-frog-blue".
 */
export function generatePassphrase(words: 3 | 4 = 3): string {
  const pool = PASSPHRASE_WORDS.length;
  const selected: string[] = [];
  // Fisher-Yates partial shuffle: pick `words` indices without replacement.
  const indices = Array.from({ length: pool }, (_, i) => i);
  for (let i = 0; i < words; i++) {
    // Pick a random position in the remaining slice [i, pool)
    const j = i + randomInt(pool - i);
    // Swap
    const tmp = indices[i];
    indices[i] = indices[j];
    indices[j] = tmp;
    selected.push(PASSPHRASE_WORDS[indices[i]]);
  }
  return selected.join('-');
}

/**
 * Return true if `input` is a plausibly-shaped passphrase.
 *
 * Accepts if and only if:
 *   - 2 to 4 lowercase tokens joined by single hyphens
 *   - Each token is a member of PASSPHRASE_WORDS
 *
 * Used to reject obviously bogus signup attempts before hitting the DB.
 *
 * @param input - The candidate passphrase string.
 * @returns true if the input is a valid-shaped passphrase.
 */
export function validatePassphraseShape(input: string): boolean {
  if (!input || typeof input !== 'string') return false;

  // Must not start or end with a hyphen
  if (input.startsWith('-') || input.endsWith('-')) return false;

  const tokens = input.split('-');

  // Require 2–4 tokens
  if (tokens.length < 2 || tokens.length > 4) return false;

  // Every token must be a member of PASSPHRASE_WORDS
  return tokens.every((token) => WORDS_SET.has(token));
}
