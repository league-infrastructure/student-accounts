/**
 * Tests for client/src/lib/llm-proxy-format (sprint 003, ticket 004).
 */
import { describe, it, expect } from 'vitest';
import {
  usageLine,
  usagePercent,
  deriveStatus,
  maskToken,
  formatUsd,
  formatShortDate,
} from '../../client/src/lib/llm-proxy-format';

describe('usageLine', () => {
  it('shows dollars and the reset date when a budget exists', () => {
    const line = usageLine({
      enabled: true,
      budgetUsd: 5,
      spentUsd: 0.75,
      periodResetsAt: '2026-11-01T00:00:00.000Z',
    });
    expect(line).toMatch(/^\$0\.75 of \$5\.00 this month · resets /);
    expect(line).toMatch(/Nov 1/);
  });

  it('falls back to tokens when budgetUsd is null', () => {
    expect(usageLine({ enabled: true, budgetUsd: null, tokensUsed: 1000, tokenLimit: 50000 })).toBe(
      '1,000 / 50,000 tokens',
    );
  });

  it('treats a missing spentUsd as zero', () => {
    expect(usageLine({ enabled: true, budgetUsd: 2 })).toBe('$0.00 of $2.00 this month');
  });
});

describe('usagePercent', () => {
  it('uses dollars when budgeted and tokens otherwise, clamped to 0..100', () => {
    expect(usagePercent({ enabled: true, budgetUsd: 4, spentUsd: 1 })).toBe(25);
    expect(usagePercent({ enabled: true, budgetUsd: null, tokensUsed: 50, tokenLimit: 100 })).toBe(50);
    expect(usagePercent({ enabled: true, budgetUsd: 1, spentUsd: 3 })).toBe(100);
    expect(usagePercent({ enabled: true, budgetUsd: 0, spentUsd: 3 })).toBe(0);
  });
});

describe('deriveStatus', () => {
  const now = new Date('2026-10-18T12:00:00Z');
  it('is disabled when not enabled', () => {
    expect(deriveStatus({ enabled: false }, now)).toBe('disabled');
  });
  it('is revoked when revokedAt is set', () => {
    expect(deriveStatus({ enabled: true, revokedAt: '2026-10-01T00:00:00Z' }, now)).toBe('revoked');
  });
  it('is expired when expiresAt is in the past, active otherwise', () => {
    expect(deriveStatus({ enabled: true, expiresAt: '2026-10-01T00:00:00Z' }, now)).toBe('expired');
    expect(deriveStatus({ enabled: true, expiresAt: '2026-12-01T00:00:00Z' }, now)).toBe('active');
    expect(deriveStatus({ enabled: true }, now)).toBe('active');
  });
});

describe('maskToken / formatUsd / formatShortDate', () => {
  it('masks the middle of a long token and leaves short ones alone', () => {
    expect(maskToken('llmp_abcdefghijklmnopqrstuvwxyz')).toBe('llmp_abcd…wxyz');
    expect(maskToken('llmp_short')).toBe('llmp_short');
  });
  it('formats dollars with two decimals', () => {
    expect(formatUsd(5)).toBe('$5.00');
    expect(formatUsd(0.456)).toBe('$0.46');
  });
  it('formats a short date and tolerates garbage', () => {
    expect(formatShortDate('2026-11-01T00:00:00.000Z')).toMatch(/Nov 1/);
    expect(formatShortDate(null)).toBe('—');
    expect(formatShortDate('not a date')).toBe('—');
  });
});
