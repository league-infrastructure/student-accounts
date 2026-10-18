/**
 * password.ts — password hashing and verification.
 *
 * No npm dependencies — uses only the Node.js built-in crypto module.
 *
 * Two hash formats are understood:
 *
 * 1. scrypt (this app's native format): "<saltHex>:<keyHex>"
 *      - salt: 16 random bytes, stored as 32-char hex
 *      - key:  64 bytes from scrypt, stored as 128-char hex
 *
 * 2. SHA-512 crypt (glibc `crypt(3)`, used by the League laptops' PAM hook):
 *      "$6$<salt>$<86-char-base64>" or "$6$rounds=<N>$<salt>$<86-char-base64>"
 *    Implemented here in TypeScript from the glibc specification
 *    (Ulrich Drepper, "Unix crypt using SHA-256 and SHA-512",
 *    https://www.akkadia.org/drepper/SHA-crypt.txt) rather than pulling in
 *    a package: the algorithm is ~100 lines over `createHash('sha512')`,
 *    nothing in the lockfile already provides it, and the spec ships test
 *    vectors (see tests/server/utils/password.test.ts) that pin the
 *    implementation. Default 5000 rounds, 16-char salt from `./0-9A-Za-z`.
 *
 * `verifyPassword` dispatches on the stored format so callers do not need to
 * know which one a user has. Anything that is neither (`!`, `*`, empty,
 * malformed) never verifies.
 */

import { createHash, randomInt, scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { generatePassphrase } from './passphrase.js';

const scryptAsync = promisify(scrypt);

/** scrypt parameters — cost, block size, parallelism, key length. */
const KEY_LENGTH = 64;

// ---------------------------------------------------------------------------
// scrypt
// ---------------------------------------------------------------------------

/**
 * Hash a plaintext password with scrypt.
 *
 * Generates a random 16-byte salt, derives a 64-byte key using scrypt,
 * and returns the result in "<saltHex>:<keyHex>" format.
 *
 * @param plain - The plaintext password. Must be non-empty.
 * @returns Promise resolving to the stored hash string.
 * @throws {Error} if plain is empty.
 */
export async function hashPassword(plain: string): Promise<string> {
  if (!plain) throw new Error('hashPassword: plain must be non-empty');
  const salt = randomBytes(16);
  const key = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
  return `${salt.toString('hex')}:${key.toString('hex')}`;
}

/** True when `stored` has the "<saltHex>:<keyHex>" scrypt shape. */
export function isScryptHash(stored: string): boolean {
  return typeof stored === 'string' && /^[0-9a-f]+:[0-9a-f]+$/i.test(stored);
}

/**
 * Verify a plaintext password against a stored scrypt hash.
 *
 * Re-derives the key using the salt embedded in `stored` and compares
 * using timingSafeEqual to prevent timing attacks.
 *
 * Returns false (rather than throwing) for any malformed input or
 * length mismatch.
 */
async function verifyScryptHash(plain: string, stored: string): Promise<boolean> {
  const colonIdx = stored.indexOf(':');
  if (colonIdx === -1) return false;

  const saltHex = stored.slice(0, colonIdx);
  const keyHex = stored.slice(colonIdx + 1);

  // Validate hex strings before creating Buffers
  if (saltHex.length === 0 || keyHex.length === 0) return false;
  if (!/^[0-9a-f]+$/i.test(saltHex) || !/^[0-9a-f]+$/i.test(keyHex)) {
    return false;
  }

  const salt = Buffer.from(saltHex, 'hex');
  const storedKey = Buffer.from(keyHex, 'hex');

  // storedKey must be exactly KEY_LENGTH bytes; otherwise lengths won't match
  // and timingSafeEqual would throw.
  if (storedKey.length !== KEY_LENGTH) return false;

  try {
    const derivedKey = (await scryptAsync(plain, salt, KEY_LENGTH)) as Buffer;
    return timingSafeEqual(derivedKey, storedKey);
  } catch {
    return false;
  }
}

// ---------------------------------------------------------------------------
// SHA-512 crypt ($6$)
// ---------------------------------------------------------------------------

const CRYPT_PREFIX = '$6$';
const CRYPT_ROUNDS_DEFAULT = 5000;
const CRYPT_ROUNDS_MIN = 1000;
const CRYPT_ROUNDS_MAX = 999_999_999;
const CRYPT_SALT_MAX = 16;
const CRYPT_ALPHABET = './0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
const CRYPT_SALT_RE = /^[./0-9A-Za-z]+$/;
/** `$6$`, optional `rounds=N$`, salt, `$`, 86 base64 chars. */
const CRYPT_HASH_RE = /^\$6\$(?:rounds=(\d{1,9})\$)?([./0-9A-Za-z]{1,16})\$([./0-9A-Za-z]{86})$/;

/** True when `stored` looks like a SHA-512 crypt hash (`$6$...`). */
export function isCryptHash(stored: string): boolean {
  return typeof stored === 'string' && stored.startsWith(CRYPT_PREFIX);
}

interface ParsedCryptHash {
  rounds: number;
  roundsExplicit: boolean;
  salt: string;
  hash: string;
}

function parseCryptHash(stored: string): ParsedCryptHash | null {
  const m = CRYPT_HASH_RE.exec(stored);
  if (!m) return null;
  const roundsExplicit = m[1] !== undefined;
  const rounds = roundsExplicit ? clampRounds(Number(m[1])) : CRYPT_ROUNDS_DEFAULT;
  return { rounds, roundsExplicit, salt: m[2], hash: m[3] };
}

function clampRounds(n: number): number {
  if (!Number.isFinite(n)) return CRYPT_ROUNDS_DEFAULT;
  return Math.min(CRYPT_ROUNDS_MAX, Math.max(CRYPT_ROUNDS_MIN, Math.floor(n)));
}

function sha512(...parts: Buffer[]): Buffer {
  const h = createHash('sha512');
  for (const p of parts) h.update(p);
  return h.digest();
}

/** Repeat `src` to exactly `length` bytes (whole copies, then a prefix). */
function repeatTo(src: Buffer, length: number): Buffer {
  const out = Buffer.alloc(length);
  for (let i = 0; i < length; i += src.length) {
    src.copy(out, i, 0, Math.min(src.length, length - i));
  }
  return out;
}

/**
 * The SHA-512 crypt core: 64-byte digest for (password, salt, rounds).
 * Step numbers follow the glibc specification.
 */
function sha512CryptDigest(password: Buffer, salt: Buffer, rounds: number): Buffer {
  const plen = password.length;

  // Steps 4-8: digest B = SHA512(password + salt + password)
  const B = sha512(password, salt, password);

  // Steps 1-3, 9-12: digest A
  const ctxA = createHash('sha512');
  ctxA.update(password);
  ctxA.update(salt);
  ctxA.update(repeatTo(B, plen)); // steps 9-10
  // Step 11: for each bit of plen, add B (bit set) or password (bit clear)
  for (let cnt = plen; cnt > 0; cnt >>= 1) {
    ctxA.update(cnt & 1 ? B : password);
  }
  const A = ctxA.digest();

  // Steps 13-16: DP = SHA512(password repeated plen times); P = DP stretched to plen
  const ctxDP = createHash('sha512');
  for (let i = 0; i < plen; i++) ctxDP.update(password);
  const P = repeatTo(ctxDP.digest(), plen);

  // Steps 17-20: DS = SHA512(salt repeated 16 + A[0] times); S = DS stretched to salt length
  const ctxDS = createHash('sha512');
  for (let i = 0; i < 16 + A[0]; i++) ctxDS.update(salt);
  const S = repeatTo(ctxDS.digest(), salt.length);

  // Step 21: the rounds loop
  let C = A;
  for (let i = 0; i < rounds; i++) {
    const ctx = createHash('sha512');
    ctx.update(i & 1 ? P : C);
    if (i % 3 !== 0) ctx.update(S);
    if (i % 7 !== 0) ctx.update(P);
    ctx.update(i & 1 ? C : P);
    C = ctx.digest();
  }
  return C;
}

/** Step 22(e): the crypt-specific base64 ordering of the 64-byte digest. */
function cryptBase64(C: Buffer): string {
  let out = '';
  const emit = (b2: number, b1: number, b0: number, n: number): void => {
    let w = (b2 << 16) | (b1 << 8) | b0;
    for (let i = 0; i < n; i++) {
      out += CRYPT_ALPHABET[w & 0x3f];
      w >>>= 6;
    }
  };
  // Byte triples in the order the spec dictates (0,21,42), (22,43,1), ...
  const order: Array<[number, number, number]> = [
    [0, 21, 42], [22, 43, 1], [44, 2, 23], [3, 24, 45], [25, 46, 4], [47, 5, 26],
    [6, 27, 48], [28, 49, 7], [50, 8, 29], [9, 30, 51], [31, 52, 10], [53, 11, 32],
    [12, 33, 54], [34, 55, 13], [56, 14, 35], [15, 36, 57], [37, 58, 16], [59, 17, 38],
    [18, 39, 60], [40, 61, 19], [62, 20, 41],
  ];
  for (const [a, b, c] of order) emit(C[a], C[b], C[c], 4);
  emit(0, 0, C[63], 2);
  return out;
}

function formatCryptHash(salt: string, rounds: number, roundsExplicit: boolean, digest: string): string {
  const roundsPart = roundsExplicit ? `rounds=${rounds}$` : '';
  return `${CRYPT_PREFIX}${roundsPart}${salt}$${digest}`;
}

/**
 * Produce a SHA-512 crypt hash the League laptops' `crypt(3)` accepts.
 *
 * @param password - Plaintext. Must be non-empty.
 * @param rounds   - Iteration count; omitted = 5000 (glibc default, no
 *                   `rounds=` in the output). Clamped to [1000, 999999999]
 *                   and written as `rounds=N$` when given.
 * @returns `$6$<salt>$<hash>` with a fresh 16-char salt.
 */
export function makeCryptHash(password: string, rounds?: number): string {
  if (!password) throw new Error('makeCryptHash: password must be non-empty');
  let salt = '';
  for (let i = 0; i < CRYPT_SALT_MAX; i++) {
    salt += CRYPT_ALPHABET[randomInt(CRYPT_ALPHABET.length)];
  }
  const roundsExplicit = rounds !== undefined;
  const effectiveRounds = roundsExplicit ? clampRounds(rounds) : CRYPT_ROUNDS_DEFAULT;
  const digest = sha512CryptDigest(Buffer.from(password, 'utf8'), Buffer.from(salt, 'ascii'), effectiveRounds);
  return formatCryptHash(salt, effectiveRounds, roundsExplicit, cryptBase64(digest));
}

/**
 * Verify a plaintext against a `$6$` hash with a constant-time comparison.
 *
 * Returns false (never throws) for an empty password, an unparseable hash,
 * or a mismatch. Accepts both `$6$salt$hash` and `$6$rounds=N$salt$hash`.
 */
export function verifyCryptHash(password: string, stored: string): boolean {
  if (!password || !stored) return false;
  const parsed = parseCryptHash(stored);
  if (parsed == null || !CRYPT_SALT_RE.test(parsed.salt)) return false;
  const digest = sha512CryptDigest(
    Buffer.from(password, 'utf8'),
    Buffer.from(parsed.salt, 'ascii'),
    parsed.rounds,
  );
  const computed = Buffer.from(cryptBase64(digest), 'ascii');
  const expected = Buffer.from(parsed.hash, 'ascii');
  return computed.length === expected.length && timingSafeEqual(computed, expected);
}

// ---------------------------------------------------------------------------
// Dispatch
// ---------------------------------------------------------------------------

/**
 * Verify a plaintext password against whatever hash the user has stored.
 *
 *   - `$6$...`          → SHA-512 crypt (imported laptop accounts)
 *   - `<hex>:<hex>`     → scrypt (this app's native format)
 *   - anything else (`!`, `*`, empty, malformed) → false
 *
 * Never throws.
 *
 * @param plain  - The plaintext password to check.
 * @param stored - The stored hash string.
 * @returns Promise resolving to true if the password matches, false otherwise.
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (!plain || !stored || typeof plain !== 'string' || typeof stored !== 'string') return false;
  if (isCryptHash(stored)) return verifyCryptHash(plain, stored);
  if (isScryptHash(stored)) return verifyScryptHash(plain, stored);
  return false;
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

/**
 * Generate a memorable password: three distinct lowercase words joined by
 * `-`, e.g. `maple-robot-seven`. Draws from the kid-safe curated word list
 * in passphrase-words.ts (the same list the signup passphrases use) rather
 * than a second embedded list, so every word has already been reviewed for
 * the audience.
 */
export function generatePassword(): string {
  return generatePassphrase(3);
}
