/**
 * Laptop roster id rules — shared with the laptops (`ubuntu-install`,
 * `league-helper`), which materialise a Unix account named after the id.
 * An id is the object-key segment in `students/<id>/config.json`, so these
 * checks are also what keeps every key under `students/`.
 */

/** Unix-safe login name: lowercase alphanumerics and hyphens, 3–32 chars. */
export const ROSTER_ID_PATTERN = /^[a-z0-9][a-z0-9-]{2,31}$/;

/** Names the laptops refuse because a system account already owns them. */
export const RESERVED_ROSTER_IDS: ReadonlySet<string> = new Set([
  'student',
  'root',
  'ansible',
  'ubuntu',
  'admin',
  'adm',
  'daemon',
  'nobody',
  'gdm',
  'sync',
  'bin',
  'sys',
]);

/** True when `id` matches the pattern and is not a reserved system name. */
export function isValidRosterId(id: unknown): id is string {
  return typeof id === 'string' && ROSTER_ID_PATTERN.test(id) && !RESERVED_ROSTER_IDS.has(id);
}

export class InvalidRosterIdError extends Error {
  readonly id: unknown;
  constructor(id: unknown) {
    super(`Invalid laptop roster id: ${JSON.stringify(id)}`);
    this.name = 'InvalidRosterIdError';
    this.id = id;
  }
}

/** Throw InvalidRosterIdError unless `id` is a valid roster id. */
export function assertValidRosterId(id: unknown): asserts id is string {
  if (!isValidRosterId(id)) throw new InvalidRosterIdError(id);
}
