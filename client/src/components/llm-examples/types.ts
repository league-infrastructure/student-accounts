/**
 * Shared shapes for the LLM proxy setup examples (sprint 003, ticket 004).
 *
 * Every template is a pure function from the student's real connection
 * details to copy-pasteable text. Templates never name a model vendor:
 * the proxy exposes League tiers (`league-small|medium|large`) and the
 * tier ids arrive from the server (`models`), so a rename needs no client
 * change.
 */

export interface ExampleContext {
  /** Proxy base URL, e.g. `https://accounts.example.org/proxy` (no `/v1`). */
  endpoint: string;
  /** The student's plaintext bearer token (`llmp_…`). */
  token: string;
  /** League tier ids, most capable first, from GET /api/account/llm-proxy. */
  models: string[];
  /** Anthropic-compatible base (`<origin>/proxy`); present only when enabled. */
  anthropicEndpoint?: string;
}

export interface SetupExample {
  /** Tab / section label, e.g. "Claude Code". */
  title: string;
  /** The exact text the Copy button puts on the clipboard. */
  body: string;
  /** One line telling the student how to check it worked. */
  howToTest: string;
}

export type ExampleBuilder = (ctx: ExampleContext) => SetupExample;

/** Tier names the templates reach for. */
export type TierName = 'small' | 'medium' | 'large';

/** Fallback when the server sends no model list (older servers, tests). */
export const DEFAULT_LEAGUE_MODELS: readonly string[] = [
  'league-large',
  'league-medium',
  'league-small',
];

/**
 * Pick the tier id for a size from the server's list, falling back to the
 * conventional `league-<size>` name so a template never renders `undefined`.
 */
export function tier(models: readonly string[], name: TierName): string {
  return models.find((m) => m.endsWith(`-${name}`)) ?? `league-${name}`;
}

/** The server's list if it has entries, else the defaults. */
export function modelsOrDefault(models: readonly string[] | undefined | null): string[] {
  return models && models.length > 0 ? [...models] : [...DEFAULT_LEAGUE_MODELS];
}
