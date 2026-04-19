/**
 * Merge services — re-exports for convenient importing.
 * Sprint 007.
 */

export type {
  UserSnapshot,
  HaikuSimilarityResult,
  HaikuClient,
} from './haiku.client.js';

export {
  HaikuApiError,
  HaikuParseError,
  HaikuClientImpl,
} from './haiku.client.js';
