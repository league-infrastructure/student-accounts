/**
 * AttemptLimiter — in-memory failed-attempt throttle for public credential
 * endpoints (sprint 002 T007, `POST /api/fleet/llm-token`).
 *
 * Keyed by arbitrary strings; the fleet route uses one key per client IP and
 * one per username so a single machine hammering many usernames and many
 * machines hammering one username are both caught. After `maxFailures`
 * failures within `windowMs` the key is blocked until the window measured
 * from the first failure has elapsed. Blocking is checked *before*
 * verification, so a correct password is still refused while blocked.
 *
 * Deliberately in-memory: the app runs as a single replica and the only
 * cost of losing state on restart is a brute-forcer getting five more tries.
 * Expired entries are pruned opportunistically so the map cannot grow
 * without bound.
 *
 * Tests use `resetAttemptLimiter()` (or construct their own instance with an
 * injectable clock) so route tests do not bleed into each other.
 */

export const ATTEMPT_LIMIT_MAX_FAILURES = 5;
export const ATTEMPT_LIMIT_WINDOW_MS = 15 * 60 * 1000;

/** Prune expired entries whenever the map grows past this many keys. */
const PRUNE_THRESHOLD = 1000;

type Entry = { count: number; firstAt: number };

export class AttemptLimiter {
  private readonly entries = new Map<string, Entry>();

  constructor(
    private readonly maxFailures: number = ATTEMPT_LIMIT_MAX_FAILURES,
    private readonly windowMs: number = ATTEMPT_LIMIT_WINDOW_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** True when the key has reached the failure cap inside the window. */
  isBlocked(key: string): boolean {
    const entry = this.live(key);
    return entry != null && entry.count >= this.maxFailures;
  }

  /** Record one failed attempt against the key. */
  recordFailure(key: string): void {
    const t = this.now();
    const entry = this.live(key);
    if (entry) {
      entry.count += 1;
    } else {
      this.entries.set(key, { count: 1, firstAt: t });
    }
    if (this.entries.size > PRUNE_THRESHOLD) this.prune();
  }

  /** Forget the key (a successful attempt below the cap). */
  clear(key: string): void {
    this.entries.delete(key);
  }

  /** Forget every key — test hook. */
  reset(): void {
    this.entries.clear();
  }

  /** Failures currently counted against the key (0 when none or expired). */
  failures(key: string): number {
    return this.live(key)?.count ?? 0;
  }

  /** The entry for `key` if its window is still open; expired ones are dropped. */
  private live(key: string): Entry | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (this.now() - entry.firstAt >= this.windowMs) {
      this.entries.delete(key);
      return undefined;
    }
    return entry;
  }

  private prune(): void {
    const t = this.now();
    for (const [key, entry] of this.entries) {
      if (t - entry.firstAt >= this.windowMs) this.entries.delete(key);
    }
  }
}

/** Shared instance for the fleet credential endpoints. */
export const fleetAttemptLimiter = new AttemptLimiter();

/** Test hook: clear every counted failure on the shared instance. */
export function resetAttemptLimiter(): void {
  fleetAttemptLimiter.reset();
}
