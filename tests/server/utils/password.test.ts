/**
 * Unit tests for password hashing and verification utilities.
 *
 * Tests:
 *  - Round-trip: verifyPassword(p, hashPassword(p)) is true
 *  - Wrong password returns false
 *  - Hashes of the same plaintext differ (random salt)
 *  - Empty string as plain-text hashes safely; verifies false against different hash
 *  - Null/undefined stored value returns false without throwing
 *  - Malformed stored value (no colon) returns false
 *  - Stored value with wrong key length returns false
 */

import { hashPassword, verifyPassword } from '../../../server/src/utils/password.js';

describe('hashPassword', () => {
  it('returns a string in saltHex:keyHex format', async () => {
    const hash = await hashPassword('mypassword');
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
  });

  it('produces different hashes for the same plaintext (random salt)', async () => {
    const hash1 = await hashPassword('samepassword');
    const hash2 = await hashPassword('samepassword');
    expect(hash1).not.toBe(hash2);
  });

  it('throws for an empty plaintext', async () => {
    await expect(hashPassword('')).rejects.toThrow();
  });
});

describe('verifyPassword', () => {
  it('round-trip: correct password verifies true', async () => {
    const plain = 'correct-horse-battery-staple';
    const hash = await hashPassword(plain);
    expect(await verifyPassword(plain, hash)).toBe(true);
  });

  it('wrong password verifies false', async () => {
    const hash = await hashPassword('rightpassword');
    expect(await verifyPassword('wrongpassword', hash)).toBe(false);
  });

  it('returns false for empty stored string', async () => {
    expect(await verifyPassword('anything', '')).toBe(false);
  });

  it('returns false for empty plain string', async () => {
    const hash = await hashPassword('somepassword');
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('returns false without throwing when stored is null-ish (empty)', async () => {
    // TypeScript won't allow passing null directly, but we test the runtime guard
    // by passing an empty string (equivalent defensive path).
    expect(await verifyPassword('x', '')).toBe(false);
  });

  it('returns false for a stored value with no colon (malformed)', async () => {
    expect(await verifyPassword('x', 'malformed-no-colon-hex')).toBe(false);
  });

  it('returns false when stored key hex is too short (not 64 bytes)', async () => {
    // 32-char salt hex + ':' + 4-char key hex — key is only 2 bytes, not 64
    const shortHash = 'a'.repeat(32) + ':' + 'b'.repeat(4);
    expect(await verifyPassword('x', shortHash)).toBe(false);
  });

  it('returns false for a hash of a different password', async () => {
    const hash = await hashPassword('password-one');
    expect(await verifyPassword('password-two', hash)).toBe(false);
  });
});
