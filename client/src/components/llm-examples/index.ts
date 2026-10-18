/**
 * Registry of the LLM proxy setup examples, in display order.
 *
 * `requiresAnthropic` marks templates that only work when the server's
 * Anthropic-compatible surface is on (`anthropicEnabled` in the account
 * payload); the component hides them otherwise.
 */
import { claudeCode } from './claude-code';
import { curl } from './curl';
import { continueDev } from './continue';
import { opencode } from './opencode';
import { hermes } from './hermes';
import { python } from './python';
import { env } from './env';
import type { ExampleBuilder } from './types';

export interface ExampleEntry {
  /** Stable id used for tab keys and test ids. */
  id: string;
  build: ExampleBuilder;
  requiresAnthropic?: boolean;
}

export const EXAMPLES: readonly ExampleEntry[] = [
  { id: 'claude-code', build: claudeCode, requiresAnthropic: true },
  { id: 'curl', build: curl },
  { id: 'continue', build: continueDev },
  { id: 'opencode', build: opencode },
  { id: 'hermes', build: hermes },
  { id: 'python', build: python },
  { id: 'env', build: env },
];

export { claudeCode, curl, continueDev, opencode, hermes, python, env };
export * from './types';
