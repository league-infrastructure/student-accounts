/**
 * FakeHaikuClient — test double for HaikuClient.
 * Sprint 007, T002.
 *
 * Implements the HaikuClient interface using in-memory state.
 * No network calls are made. All calls to `evaluate` are recorded
 * in `calls` for test assertions.
 *
 * Configurable behavior:
 *  - `configure(result)` — override the default return value for evaluate.
 *  - `configureError(error)` — make evaluate throw an error.
 *  - `reset()` — clear all recorded calls and configured overrides.
 *
 * Default return value (when no override is configured):
 *  - evaluate → { confidence: 0.5, rationale: 'Fake evaluation result.' }
 *
 * Usage in tests:
 *
 *   const fake = new FakeHaikuClient();
 *
 *   // Override the return value
 *   fake.configure({ confidence: 0.9, rationale: 'Very likely the same person.' });
 *
 *   // Make evaluate throw
 *   fake.configureError(new HaikuApiError('API unavailable'));
 *
 *   // Assert calls
 *   expect(fake.calls).toHaveLength(1);
 *   expect(fake.calls[0].userA.id).toBe(1);
 *
 *   // Reset between tests
 *   fake.reset();
 */

import type {
  HaikuClient,
  UserSnapshot,
  HaikuSimilarityResult,
} from '../../../server/src/services/merge/haiku.client.js';

// ---------------------------------------------------------------------------
// Call record type
// ---------------------------------------------------------------------------

export interface FakeHaikuCallRecord {
  userA: UserSnapshot;
  userB: UserSnapshot;
}

// ---------------------------------------------------------------------------
// FakeHaikuClient
// ---------------------------------------------------------------------------

export class FakeHaikuClient implements HaikuClient {
  /** All calls made to `evaluate`, in order. */
  readonly calls: FakeHaikuCallRecord[] = [];

  private returnOverride?: HaikuSimilarityResult;
  private errorOverride?: Error;

  /**
   * Configure a return value for evaluate. Overrides the built-in default.
   */
  configure(result: HaikuSimilarityResult): void {
    this.returnOverride = result;
  }

  /**
   * Configure evaluate to throw an error when called.
   */
  configureError(error: Error): void {
    this.errorOverride = error;
  }

  /**
   * Reset all recorded calls and configured overrides.
   * Call between tests to ensure test isolation.
   */
  reset(): void {
    this.calls.length = 0;
    this.returnOverride = undefined;
    this.errorOverride = undefined;
  }

  // ---------------------------------------------------------------------------
  // HaikuClient implementation
  // ---------------------------------------------------------------------------

  async evaluate(userA: UserSnapshot, userB: UserSnapshot): Promise<HaikuSimilarityResult> {
    this.calls.push({ userA, userB });
    if (this.errorOverride) {
      throw this.errorOverride;
    }
    return this.returnOverride ?? {
      confidence: 0.5,
      rationale: 'Fake evaluation result.',
    };
  }
}
