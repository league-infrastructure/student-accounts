/**
 * password.ts — scrypt-based password hashing and verification.
 *
 * No npm dependencies — uses only Node.js built-in crypto module.
 *
 * Storage format: "<saltHex>:<keyHex>"
 *   - salt: 16 random bytes, stored as 32-char hex
 *   - key:  64 bytes from scrypt, stored as 128-char hex
 */

import { scrypt, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);

/** scrypt parameters — cost, block size, parallelism, key length. */
const KEY_LENGTH = 64;

/**
 * Hash a plaintext password.
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

/**
 * Verify a plaintext password against a stored hash.
 *
 * Re-derives the key using the salt embedded in `stored` and compares
 * using timingSafeEqual to prevent timing attacks.
 *
 * Returns false (rather than throwing) for any malformed input or
 * length mismatch.
 *
 * @param plain  - The plaintext password to check.
 * @param stored - The stored "<saltHex>:<keyHex>" string.
 * @returns Promise resolving to true if the password matches, false otherwise.
 */
export async function verifyPassword(
  plain: string,
  stored: string,
): Promise<boolean> {
  if (!plain || !stored) return false;

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
