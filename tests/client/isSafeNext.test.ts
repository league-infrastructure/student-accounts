import { describe, it, expect } from 'vitest';
import { isSafeNext } from '../../client/src/pages/login/isSafeNext';

describe('isSafeNext', () => {
  // Happy paths
  it("'/account' → true", () => {
    expect(isSafeNext('/account')).toBe(true);
  });

  it("'/legit/path' → true", () => {
    expect(isSafeNext('/legit/path')).toBe(true);
  });

  it("'/legit?with=query&more=params' → true", () => {
    expect(isSafeNext('/legit?with=query&more=params')).toBe(true);
  });

  it("'/oauth/authorize?response_type=code&client_id=abc' → true", () => {
    expect(isSafeNext('/oauth/authorize?response_type=code&client_id=abc')).toBe(true);
  });

  // Scheme-relative attacks
  it("'//evil.com' → false (scheme-relative attack)", () => {
    expect(isSafeNext('//evil.com')).toBe(false);
  });

  it("'///evil.com' → false", () => {
    expect(isSafeNext('///evil.com')).toBe(false);
  });

  // Backslash redirect
  it("'/\\\\evil.com' → false (backslash after /)", () => {
    expect(isSafeNext('/\\evil.com')).toBe(false);
  });

  // Absolute URLs
  it("'https://evil.com' → false", () => {
    expect(isSafeNext('https://evil.com')).toBe(false);
  });

  it("'http://evil.com/path' → false", () => {
    expect(isSafeNext('http://evil.com/path')).toBe(false);
  });

  // javascript: URI
  it("'javascript:alert(1)' → false", () => {
    expect(isSafeNext('javascript:alert(1)')).toBe(false);
  });

  // Empty / null / undefined
  it("'' → false", () => {
    expect(isSafeNext('')).toBe(false);
  });

  it('null → false', () => {
    expect(isSafeNext(null)).toBe(false);
  });

  it('undefined → false', () => {
    expect(isSafeNext(undefined)).toBe(false);
  });

  // Control characters
  it("'/with\\x00nullbyte' → false", () => {
    expect(isSafeNext('/with\x00nullbyte')).toBe(false);
  });

  it("'/with\\x1fnewline' → false", () => {
    expect(isSafeNext('/with\x1fnewline')).toBe(false);
  });
});
