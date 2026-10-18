/**
 * Unit tests for laptop roster id validation (sprint 002 T002).
 */
import { describe, it, expect } from 'vitest';
import {
  isValidRosterId,
  assertValidRosterId,
  InvalidRosterIdError,
  RESERVED_ROSTER_IDS,
} from '../../../server/src/services/laptop/roster-ids.js';

describe('isValidRosterId', () => {
  it('accepts lowercase alphanumerics and hyphens, 3 to 32 chars', () => {
    expect(isValidRosterId('abc')).toBe(true);
    expect(isValidRosterId('alice')).toBe(true);
    expect(isValidRosterId('a1-b2')).toBe(true);
    expect(isValidRosterId('0start')).toBe(true);
    expect(isValidRosterId('a'.repeat(32))).toBe(true);
  });

  it('rejects ids that are too short or too long', () => {
    expect(isValidRosterId('')).toBe(false);
    expect(isValidRosterId('ab')).toBe(false);
    expect(isValidRosterId('a'.repeat(33))).toBe(false);
  });

  it('rejects uppercase, leading hyphen, and other characters', () => {
    expect(isValidRosterId('Alice')).toBe(false);
    expect(isValidRosterId('-abc')).toBe(false);
    expect(isValidRosterId('al ice')).toBe(false);
    expect(isValidRosterId('al.ice')).toBe(false);
    expect(isValidRosterId('al_ice')).toBe(false);
    expect(isValidRosterId('alice@x')).toBe(false);
  });

  it('rejects anything that could escape the students/ prefix', () => {
    expect(isValidRosterId('..')).toBe(false);
    expect(isValidRosterId('../etc')).toBe(false);
    expect(isValidRosterId('a/b')).toBe(false);
    expect(isValidRosterId('a\\b')).toBe(false);
  });

  it('rejects every reserved system name', () => {
    const reserved = ['student', 'root', 'ansible', 'ubuntu', 'admin', 'adm', 'daemon', 'nobody', 'gdm', 'sync', 'bin', 'sys'];
    expect(Array.from(RESERVED_ROSTER_IDS).sort()).toEqual([...reserved].sort());
    for (const name of reserved) expect(isValidRosterId(name)).toBe(false);
  });

  it('rejects non-strings', () => {
    expect(isValidRosterId(undefined)).toBe(false);
    expect(isValidRosterId(null)).toBe(false);
    expect(isValidRosterId(42)).toBe(false);
  });
});

describe('assertValidRosterId', () => {
  it('returns silently for a valid id', () => {
    expect(() => assertValidRosterId('alice')).not.toThrow();
  });

  it('throws InvalidRosterIdError naming the id otherwise', () => {
    expect(() => assertValidRosterId('root')).toThrow(InvalidRosterIdError);
    expect(() => assertValidRosterId('../x')).toThrow(/Invalid laptop roster id: "\.\.\/x"/);
  });
});
