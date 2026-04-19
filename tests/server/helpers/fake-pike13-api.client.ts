/**
 * FakePike13ApiClient — test double for Pike13ApiClient.
 *
 * Implements the Pike13ApiClient interface using in-memory state.
 * No network calls are made. All methods record their invocations in the
 * `calls` object for test assertions.
 *
 * Configurable behavior:
 *  - `configure(method, value)` — set a return value for a method (overrides
 *    the built-in default).
 *  - `configureError(method, error)` — make a method throw an error.
 *  - `reset()` — clear all recorded calls and configured overrides.
 *
 * Default return values (when no override is configured):
 *  - `listPeople`        → { people: [], nextCursor: null }
 *  - `getPerson`         → a minimal Pike13Person with the given personId
 *  - `updateCustomField` → resolves void
 *
 * Usage in tests:
 *
 *   const fake = new FakePike13ApiClient();
 *
 *   // Override a return value
 *   fake.configure('listPeople', {
 *     people: [{ id: 1, first_name: 'Alice', last_name: 'Smith', email: 'a@b.com' }],
 *     nextCursor: null,
 *   });
 *
 *   // Make a method throw
 *   fake.configureError('getPerson', new Pike13PersonNotFoundError(42, 'getPerson'));
 *
 *   // Assert calls
 *   expect(fake.calls.listPeople).toHaveLength(1);
 *   expect(fake.calls.listPeople[0]).toBe(undefined); // first page, no cursor
 *
 *   expect(fake.calls.updateCustomField).toHaveLength(1);
 *   expect(fake.calls.updateCustomField[0]).toEqual({ personId: 7, fieldId: 'f1', value: 'v1' });
 *
 *   // Reset between tests
 *   fake.reset();
 */

import type {
  Pike13ApiClient,
  Pike13Person,
  Pike13PeoplePage,
} from '../../../server/src/services/pike13/pike13-api.client.js';

// ---------------------------------------------------------------------------
// Call recorder types
// ---------------------------------------------------------------------------

export interface FakePike13CallRecords {
  /** Recorded cursor values (undefined = first page). */
  listPeople: Array<string | undefined>;
  /** Recorded person IDs. */
  getPerson: number[];
  /** Recorded {personId, fieldId, value} tuples. */
  updateCustomField: Array<{ personId: number; fieldId: string; value: string }>;
}

// ---------------------------------------------------------------------------
// Method return value overrides (keyed by method name)
// ---------------------------------------------------------------------------

type MethodReturnOverrides = {
  listPeople?: Pike13PeoplePage;
  getPerson?: Pike13Person;
  updateCustomField?: void;
};

type MethodErrorOverrides = {
  [K in keyof MethodReturnOverrides]?: Error;
};

// ---------------------------------------------------------------------------
// FakePike13ApiClient
// ---------------------------------------------------------------------------

export class FakePike13ApiClient implements Pike13ApiClient {
  /** Recorded call arguments, indexed by method name. */
  readonly calls: FakePike13CallRecords = {
    listPeople: [],
    getPerson: [],
    updateCustomField: [],
  };

  private returnOverrides: MethodReturnOverrides = {};
  private errorOverrides: MethodErrorOverrides = {};

  /**
   * Configure a return value for a method. Overrides the built-in default.
   *
   * @param method - The method name to configure.
   * @param value  - The value to return when the method is called.
   */
  configure<K extends keyof MethodReturnOverrides>(method: K, value: MethodReturnOverrides[K]): void {
    this.returnOverrides[method] = value;
  }

  /**
   * Configure a method to throw an error when called.
   *
   * @param method - The method name to configure.
   * @param error  - The error to throw.
   */
  configureError<K extends keyof MethodErrorOverrides>(method: K, error: Error): void {
    this.errorOverrides[method] = error;
  }

  /**
   * Reset all recorded calls and configured overrides.
   * Call between tests to ensure test isolation.
   */
  reset(): void {
    this.calls.listPeople = [];
    this.calls.getPerson = [];
    this.calls.updateCustomField = [];
    this.returnOverrides = {};
    this.errorOverrides = {};
  }

  // ---------------------------------------------------------------------------
  // Read methods
  // ---------------------------------------------------------------------------

  async listPeople(cursor?: string): Promise<Pike13PeoplePage> {
    this.calls.listPeople.push(cursor);
    if (this.errorOverrides.listPeople) {
      throw this.errorOverrides.listPeople;
    }
    return this.returnOverrides.listPeople ?? { people: [], nextCursor: null };
  }

  async getPerson(personId: number): Promise<Pike13Person> {
    this.calls.getPerson.push(personId);
    if (this.errorOverrides.getPerson) {
      throw this.errorOverrides.getPerson;
    }
    return (
      this.returnOverrides.getPerson ?? {
        id: personId,
        first_name: 'Fake',
        last_name: 'Person',
        email: `person-${personId}@fake.example.com`,
      }
    );
  }

  // ---------------------------------------------------------------------------
  // Write methods
  // ---------------------------------------------------------------------------

  async updateCustomField(personId: number, fieldId: string, value: string): Promise<void> {
    this.calls.updateCustomField.push({ personId, fieldId, value });
    if (this.errorOverrides.updateCustomField) {
      throw this.errorOverrides.updateCustomField;
    }
  }
}
