/**
 * Unit tests for password hashing and verification utilities.
 *
 * scrypt (native format):
 *  - Round-trip: verifyPassword(p, hashPassword(p)) is true
 *  - Wrong password returns false
 *  - Hashes of the same plaintext differ (random salt)
 *  - Null/undefined/malformed stored values return false without throwing
 *
 * SHA-512 crypt ($6$, the laptops' format) — Sprint 002 T001:
 *  - Fixture produced by `openssl passwd -6 -salt Botball26Fixture secret`
 *  - The glibc specification's own test vectors (rounds=, long/short salts)
 *  - makeCryptHash shape and round-trip through verifyCryptHash
 *  - verifyPassword dispatch: $6$ → crypt, salt:key → scrypt, else false
 *
 * generatePassword: three lowercase words joined by '-', random.
 */

import {
  hashPassword,
  verifyPassword,
  isCryptHash,
  isScryptHash,
  verifyCryptHash,
  makeCryptHash,
  generatePassword,
} from '../../../server/src/utils/password.js';
import { PASSPHRASE_WORDS } from '../../../server/src/utils/passphrase-words.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Generated once with: openssl passwd -6 -salt Botball26Fixture secret */
const OPENSSL_FIXTURE = {
  plaintext: 'secret',
  hash: '$6$Botball26Fixture$aNQlHIWlqMgpWS186K6u6SNXkL1PWiMmeBpGdgZDL.21BIQ5wEIdE6hcD3xQ0DKPXanIltLYdvSyrgOikntZ./',
};

/**
 * Test vectors from the glibc specification, "Unix crypt using SHA-256 and
 * SHA-512" (Ulrich Drepper), section "Test vectors for SHA-512". These pin
 * the rounds= handling, rounds clamping (10 → 1000) and salt truncation to
 * 16 chars; the first is also what `openssl passwd -6 -salt saltstring
 * 'Hello world!'` produces.
 */
const SPEC_VECTORS: Array<{ hash: string; plaintext: string }> = [
  {
    hash: '$6$saltstring$svn8UoSVapNtMuq1ukKS4tPQd8iKwSMHWjl/O817G3uBnIFNjnQJuesI68u4OTLiBFdcbYEdFCoEOfaS35inz1',
    plaintext: 'Hello world!',
  },
  {
    hash: '$6$rounds=10000$saltstringsaltst$OW1/O6BYHV6BcXZu8QVeXbDWra3Oeqh0sbHbbMCVNSnCM/UrjmM0Dp8vOuZeHBy/YTBmSK6H9qs/y3RnOaw5v.',
    plaintext: 'Hello world!',
  },
  {
    hash: '$6$rounds=5000$toolongsaltstrin$lQ8jolhgVRVhY4b5pZKaysCLi0QBxGoNeKQzQ3glMhwllF7oGDZxUhx1yxdYcz/e1JSbq3y6JMxxl8audkUEm0',
    plaintext: 'This is just a test',
  },
  {
    hash: '$6$rounds=1400$anotherlongsalts$POfYwTEok97VWcjxIiSOjiykti.o/pQs.wPvMxQ6Fm7I6IoYN3CmLs66x9t0oSwbtEW7o7UmJEiDwGqd8p4ur1',
    plaintext:
      'a very much longer text to encrypt.  This one even stretches over morethan one line.',
  },
  {
    hash: '$6$rounds=77777$short$WuQyW2YR.hBNpjjRhpYD/ifIw05xdfeEyQoMxIXbkvr0gge1a1x3yRULJ5CCaUeOxFmtlcGZelFl5CxtgfiAc0',
    plaintext: 'we have a short salt string but not a short password',
  },
  {
    hash: '$6$rounds=123456$asaltof16chars..$BtCwjqMJGx5hrJhZywWvt0RLE8uZ4oPwcelCjmw2kSYu.Ec6ycULevoBK25fs2xXgMNrCzIMVcgEJAstJeonj1',
    plaintext: 'a short string',
  },
  {
    // The spec feeds "rounds=10"; glibc clamps to the 1000 minimum and
    // writes the clamped value back, which is what we store and verify.
    hash: '$6$rounds=1000$roundstoolow$kUMsbe306n21p9R.FRkW3IGn.S9NPN0x50YhH1xhLsPuWGsUSklZt58jaTfF4ZEQpyUNGc0dqbpBYYBaHHrsX.',
    plaintext: 'the minimum number is still observed',
  },
];

const CRYPT_SHAPE = /^\$6\$[./0-9A-Za-z]{16}\$[./0-9A-Za-z]{86}$/;
const CRYPT_ROUNDS_SHAPE = /^\$6\$rounds=(\d+)\$[./0-9A-Za-z]{16}\$[./0-9A-Za-z]{86}$/;

// ===========================================================================
// scrypt
// ===========================================================================

describe('hashPassword', () => {
  it('returns a string in saltHex:keyHex format', async () => {
    const hash = await hashPassword('mypassword');
    expect(hash).toMatch(/^[0-9a-f]+:[0-9a-f]+$/);
    expect(isScryptHash(hash)).toBe(true);
    expect(isCryptHash(hash)).toBe(false);
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

describe('verifyPassword — scrypt', () => {
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

// ===========================================================================
// SHA-512 crypt
// ===========================================================================

describe('isCryptHash', () => {
  it('is true for $6$ hashes, with or without rounds=', () => {
    expect(isCryptHash(OPENSSL_FIXTURE.hash)).toBe(true);
    expect(isCryptHash(SPEC_VECTORS[1].hash)).toBe(true);
  });

  it('is false for scrypt, locked, empty and other-scheme values', () => {
    expect(isCryptHash('aa:bb')).toBe(false);
    expect(isCryptHash('!')).toBe(false);
    expect(isCryptHash('*')).toBe(false);
    expect(isCryptHash('')).toBe(false);
    expect(isCryptHash('$5$salt$sha256crypt')).toBe(false);
    expect(isCryptHash('$1$salt$md5crypt')).toBe(false);
  });
});

describe('verifyCryptHash — fixtures', () => {
  it('verifies the hash produced by openssl passwd -6', () => {
    expect(verifyCryptHash(OPENSSL_FIXTURE.plaintext, OPENSSL_FIXTURE.hash)).toBe(true);
  });

  it('rejects the wrong password against the openssl fixture', () => {
    expect(verifyCryptHash('Secret', OPENSSL_FIXTURE.hash)).toBe(false);
    expect(verifyCryptHash('secret ', OPENSSL_FIXTURE.hash)).toBe(false);
    expect(verifyCryptHash('secrets', OPENSSL_FIXTURE.hash)).toBe(false);
  });

  it.each(SPEC_VECTORS)('verifies glibc spec vector $hash', ({ hash, plaintext }) => {
    expect(verifyCryptHash(plaintext, hash)).toBe(true);
    expect(verifyCryptHash(plaintext + 'x', hash)).toBe(false);
  });

  it('returns false, not throws, for an empty password', () => {
    expect(verifyCryptHash('', OPENSSL_FIXTURE.hash)).toBe(false);
  });

  it('returns false, not throws, for malformed $6$ strings', () => {
    expect(verifyCryptHash('secret', '$6$')).toBe(false);
    expect(verifyCryptHash('secret', '$6$salt')).toBe(false);
    expect(verifyCryptHash('secret', '$6$salt$')).toBe(false);
    expect(verifyCryptHash('secret', '$6$salt$tooshort')).toBe(false);
    // Right length, bad alphabet in the digest
    expect(verifyCryptHash('secret', '$6$Botball26Fixture$' + '!'.repeat(86))).toBe(false);
    // Salt longer than 16 chars is never produced by glibc (it truncates)
    expect(verifyCryptHash('secret', '$6$' + 'a'.repeat(17) + '$' + 'b'.repeat(86))).toBe(false);
  });

  it('returns false when the digest is tampered with', () => {
    const h = OPENSSL_FIXTURE.hash;
    const last = h[h.length - 1] === '.' ? '/' : '.';
    expect(verifyCryptHash('secret', h.slice(0, -1) + last)).toBe(false);
  });
});

describe('makeCryptHash', () => {
  it('has the $6$<16-char salt>$<86-char digest> shape by default', () => {
    const h = makeCryptHash('secret');
    expect(h).toMatch(CRYPT_SHAPE);
    expect(isCryptHash(h)).toBe(true);
  });

  it('round-trips through verifyCryptHash and verifyPassword', async () => {
    const h = makeCryptHash('purple-cactus-river');
    expect(verifyCryptHash('purple-cactus-river', h)).toBe(true);
    expect(verifyCryptHash('purple-cactus-rivers', h)).toBe(false);
    expect(await verifyPassword('purple-cactus-river', h)).toBe(true);
  });

  it('uses a fresh random salt each time', () => {
    const a = makeCryptHash('same');
    const b = makeCryptHash('same');
    expect(a).not.toBe(b);
    expect(a.split('$')[2]).not.toBe(b.split('$')[2]);
  });

  it('writes rounds= when a round count is given, and verifies', () => {
    const h = makeCryptHash('secret', 10000);
    const m = CRYPT_ROUNDS_SHAPE.exec(h);
    expect(m).not.toBeNull();
    expect(Number(m![1])).toBe(10000);
    expect(verifyCryptHash('secret', h)).toBe(true);
  });

  it('clamps an out-of-range round count to the glibc minimum', () => {
    const h = makeCryptHash('secret', 10);
    expect(h.startsWith('$6$rounds=1000$')).toBe(true);
    expect(verifyCryptHash('secret', h)).toBe(true);
  });

  it('handles non-ASCII passwords as UTF-8', () => {
    const h = makeCryptHash('pässwörd✓');
    expect(verifyCryptHash('pässwörd✓', h)).toBe(true);
    expect(verifyCryptHash('passwörd✓', h)).toBe(false);
  });

  it('throws for an empty password', () => {
    expect(() => makeCryptHash('')).toThrow();
  });
});

// ===========================================================================
// Dispatch
// ===========================================================================

describe('verifyPassword — dispatch on stored format', () => {
  it('routes $6$ hashes to the crypt verifier', async () => {
    expect(await verifyPassword(OPENSSL_FIXTURE.plaintext, OPENSSL_FIXTURE.hash)).toBe(true);
    expect(await verifyPassword('wrong', OPENSSL_FIXTURE.hash)).toBe(false);
  });

  it('routes salt:key hashes to scrypt', async () => {
    const h = await hashPassword('native-password');
    expect(await verifyPassword('native-password', h)).toBe(true);
  });

  it('never verifies locked, starred, empty or malformed values', async () => {
    for (const stored of ['!', '*', '', '!' + OPENSSL_FIXTURE.hash, '$1$abc$def', 'plaintext', '$6$']) {
      expect(await verifyPassword('secret', stored)).toBe(false);
      expect(await verifyPassword('!', stored)).toBe(false);
    }
  });

  it('does not accept the stored hash itself as the password', async () => {
    expect(await verifyPassword(OPENSSL_FIXTURE.hash, OPENSSL_FIXTURE.hash)).toBe(false);
    const h = await hashPassword('x');
    expect(await verifyPassword(h, h)).toBe(false);
  });
});

// ===========================================================================
// generatePassword
// ===========================================================================

describe('generatePassword', () => {
  const words = new Set(PASSPHRASE_WORDS);

  it('returns three lowercase words joined by hyphens', () => {
    for (let i = 0; i < 20; i++) {
      const pw = generatePassword();
      expect(pw).toMatch(/^[a-z]+-[a-z]+-[a-z]+$/);
      const parts = pw.split('-');
      expect(parts).toHaveLength(3);
      for (const w of parts) expect(words.has(w)).toBe(true);
      // No repeated word within one password
      expect(new Set(parts).size).toBe(3);
    }
  });

  it('is random: 50 draws are (almost surely) all distinct', () => {
    const seen = new Set(Array.from({ length: 50 }, () => generatePassword()));
    expect(seen.size).toBeGreaterThan(45);
  });

  it('round-trips through hashPassword/verifyPassword', async () => {
    const pw = generatePassword();
    expect(await verifyPassword(pw, await hashPassword(pw))).toBe(true);
    expect(verifyCryptHash(pw, makeCryptHash(pw))).toBe(true);
  });
});
