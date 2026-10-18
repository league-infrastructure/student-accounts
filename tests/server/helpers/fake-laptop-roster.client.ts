/**
 * FakeLaptopRosterClient — in-memory test double for RosterClient.
 *
 * Holds entries in a Map, records every write in `writes`, and can simulate
 * a Spaces outage with `failWrites = true` (write then rejects and leaves
 * `entries` unchanged).
 *
 *   const roster = new FakeLaptopRosterClient();
 *   roster.seed({ id: 'alice', display_name: 'Alice', password_hash: '$6$...',
 *                 created: '20260825T170542Z', created_host: 'jtl-inspiron-1' });
 *   await roster.listIds();            // ['alice']
 *   await roster.write('bob', entry);  // roster.writes[0] = { id: 'bob', entry }
 *   roster.failWrites = true;          // next write rejects
 */

import type {
  RosterClient,
  RosterEntry,
} from '../../../server/src/services/laptop/laptop-roster.client.js';

export class FakeLaptopRosterClient implements RosterClient {
  /** Current roster state, id → entry. */
  readonly entries = new Map<string, RosterEntry>();
  /** Every successful or attempted write, in order. */
  readonly writes: Array<{ id: string; entry: RosterEntry }> = [];
  /** When true, write() rejects to simulate Spaces being unreachable. */
  failWrites = false;
  /** When true, listIds() and read() reject too. */
  failReads = false;

  /** Pre-populate one or more entries (keyed by entry.id). */
  seed(...entries: RosterEntry[]): this {
    for (const e of entries) this.entries.set(e.id, e);
    return this;
  }

  async listIds(): Promise<string[]> {
    if (this.failReads) throw new Error('FakeLaptopRosterClient: reads failing');
    return Array.from(this.entries.keys()).sort();
  }

  async read(id: string): Promise<RosterEntry | null> {
    if (this.failReads) throw new Error('FakeLaptopRosterClient: reads failing');
    const entry = this.entries.get(id);
    // Return a copy so tests mutating the result do not alter the fake's state.
    return entry ? { ...entry } : null;
  }

  async write(id: string, entry: RosterEntry): Promise<void> {
    this.writes.push({ id, entry: { ...entry } });
    if (this.failWrites) throw new Error('FakeLaptopRosterClient: writes failing');
    this.entries.set(id, { ...entry });
  }

  /** Clear entries, writes and failure flags. */
  reset(): void {
    this.entries.clear();
    this.writes.length = 0;
    this.failWrites = false;
    this.failReads = false;
  }
}
