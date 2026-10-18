/**
 * Unit tests for the in-memory AttemptLimiter (sprint 002 T007).
 *
 * Uses an injectable clock so window expiry is tested without sleeping.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import {
  AttemptLimiter,
  ATTEMPT_LIMIT_MAX_FAILURES,
  ATTEMPT_LIMIT_WINDOW_MS,
  fleetAttemptLimiter,
  resetAttemptLimiter,
} from '../../../server/src/middleware/attemptLimiter.js';

describe('AttemptLimiter', () => {
  let now: number;
  let limiter: AttemptLimiter;

  beforeEach(() => {
    now = 1_000_000;
    limiter = new AttemptLimiter(5, 15 * 60 * 1000, () => now);
  });

  it('defaults match the fleet policy: 5 failures in 15 minutes', () => {
    expect(ATTEMPT_LIMIT_MAX_FAILURES).toBe(5);
    expect(ATTEMPT_LIMIT_WINDOW_MS).toBe(15 * 60 * 1000);
  });

  it('is not blocked below the cap and blocked once the cap is reached', () => {
    for (let i = 0; i < 4; i++) {
      limiter.recordFailure('user:alice');
      expect(limiter.isBlocked('user:alice')).toBe(false);
    }
    limiter.recordFailure('user:alice');
    expect(limiter.failures('user:alice')).toBe(5);
    expect(limiter.isBlocked('user:alice')).toBe(true);
    // Further failures keep it blocked.
    limiter.recordFailure('user:alice');
    expect(limiter.isBlocked('user:alice')).toBe(true);
  });

  it('keys are independent', () => {
    for (let i = 0; i < 5; i++) limiter.recordFailure('ip:10.0.0.1');
    expect(limiter.isBlocked('ip:10.0.0.1')).toBe(true);
    expect(limiter.isBlocked('ip:10.0.0.2')).toBe(false);
    expect(limiter.isBlocked('user:alice')).toBe(false);
  });

  it('unblocks once the window since the first failure has elapsed', () => {
    for (let i = 0; i < 5; i++) limiter.recordFailure('user:bob');
    expect(limiter.isBlocked('user:bob')).toBe(true);

    now += 15 * 60 * 1000 - 1;
    expect(limiter.isBlocked('user:bob')).toBe(true);

    now += 1;
    expect(limiter.isBlocked('user:bob')).toBe(false);
    expect(limiter.failures('user:bob')).toBe(0);

    // A new failure starts a fresh window.
    limiter.recordFailure('user:bob');
    expect(limiter.failures('user:bob')).toBe(1);
  });

  it('failures recorded late in a window do not extend the block', () => {
    limiter.recordFailure('user:carol');
    now += 14 * 60 * 1000;
    for (let i = 0; i < 4; i++) limiter.recordFailure('user:carol');
    expect(limiter.isBlocked('user:carol')).toBe(true);
    now += 60 * 1000; // 15 minutes after the FIRST failure
    expect(limiter.isBlocked('user:carol')).toBe(false);
  });

  it('clear() forgets one key; reset() forgets all', () => {
    for (let i = 0; i < 5; i++) {
      limiter.recordFailure('user:dave');
      limiter.recordFailure('ip:1.2.3.4');
    }
    limiter.clear('user:dave');
    expect(limiter.isBlocked('user:dave')).toBe(false);
    expect(limiter.isBlocked('ip:1.2.3.4')).toBe(true);
    limiter.reset();
    expect(limiter.isBlocked('ip:1.2.3.4')).toBe(false);
  });

  it('honours a custom cap', () => {
    const two = new AttemptLimiter(2, 1000, () => now);
    two.recordFailure('k');
    expect(two.isBlocked('k')).toBe(false);
    two.recordFailure('k');
    expect(two.isBlocked('k')).toBe(true);
  });

  it('prunes expired entries when the map grows large', () => {
    for (let i = 0; i < 1001; i++) limiter.recordFailure(`user:u${i}`);
    expect(limiter.failures('user:u0')).toBe(1);
    now += 15 * 60 * 1000;
    // Crossing the prune threshold sweeps everything that has expired.
    limiter.recordFailure('user:fresh');
    expect(limiter.failures('user:u0')).toBe(0);
    expect(limiter.failures('user:fresh')).toBe(1);
  });
});

describe('shared fleetAttemptLimiter + resetAttemptLimiter()', () => {
  it('reset hook clears the shared instance', () => {
    for (let i = 0; i < 5; i++) fleetAttemptLimiter.recordFailure('user:shared');
    expect(fleetAttemptLimiter.isBlocked('user:shared')).toBe(true);
    resetAttemptLimiter();
    expect(fleetAttemptLimiter.isBlocked('user:shared')).toBe(false);
  });
});
