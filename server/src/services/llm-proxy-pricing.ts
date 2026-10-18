/**
 * TierPricing — fallback USD pricing for the LLM proxy (sprint 003).
 *
 * OpenRouter reports the cost of every request when asked
 * (`usage: {include: true}`), and that figure is what the proxy records.
 * When a provider quirk leaves `cost` absent, accounting must still never
 * write zero, so the cost is estimated from a per-tier price table:
 *
 *   LLM_PROXY_PRICE_LARGE / _MEDIUM / _SMALL = "<usd per 1M input>,<usd per 1M output>"
 *
 * The three keys live in CONFIG_KEYS (group "LLM Proxy") so an unpriced
 * model can be fixed from the admin config page without a deploy. Their
 * defaults are OpenRouter's list prices for the default tier models
 * (DEFAULT_TIER_MODELS), read from https://openrouter.ai/api/v1/models on
 * 2026-10-18:
 *
 *   deepseek/deepseek-v4-pro    $0.2088 / 1M input   $0.4176 / 1M output
 *   deepseek/deepseek-v4-flash  $0.091  / 1M input   $0.182  / 1M output
 *   deepseek/deepseek-v3.2      $0.28   / 1M input   $0.42   / 1M output
 *
 * `tierFor(modelSent)` maps the slug the forwarder actually sent upstream
 * back to a tier by comparing it with the three LLM_PROXY_MODEL_* values
 * (env, then DB config, then the defaults); anything unknown is priced as
 * MEDIUM, the same cost-control default the forwarder uses for unknown
 * requested models.
 */

import { getConfig } from './config.js';

// ---------------------------------------------------------------------------
// Tiers and defaults
// ---------------------------------------------------------------------------

export type LlmTier = 'large' | 'medium' | 'small';

export const LLM_TIERS: readonly LlmTier[] = ['large', 'medium', 'small'];

/** OpenRouter slugs used when LLM_PROXY_MODEL_* is not configured. */
export const DEFAULT_TIER_MODELS: Readonly<Record<LlmTier, string>> = {
  large: 'deepseek/deepseek-v4-pro',
  medium: 'deepseek/deepseek-v4-flash',
  small: 'deepseek/deepseek-v3.2',
};

/** "<usd per 1M input>,<usd per 1M output>" — see the module comment for the source. */
export const DEFAULT_TIER_PRICES: Readonly<Record<LlmTier, string>> = {
  large: '0.2088,0.4176',
  medium: '0.091,0.182',
  small: '0.28,0.42',
};

const MODEL_CONFIG_KEY: Readonly<Record<LlmTier, string>> = {
  large: 'LLM_PROXY_MODEL_LARGE',
  medium: 'LLM_PROXY_MODEL_MEDIUM',
  small: 'LLM_PROXY_MODEL_SMALL',
};

const PRICE_CONFIG_KEY: Readonly<Record<LlmTier, string>> = {
  large: 'LLM_PROXY_PRICE_LARGE',
  medium: 'LLM_PROXY_PRICE_MEDIUM',
  small: 'LLM_PROXY_PRICE_SMALL',
};

export const TOKENS_PER_MILLION = 1_000_000;

// ---------------------------------------------------------------------------
// Price spec parsing
// ---------------------------------------------------------------------------

export type TierPrice = {
  /** USD per 1,000,000 input (prompt) tokens. */
  inputPerMillion: number;
  /** USD per 1,000,000 output (completion) tokens. */
  outputPerMillion: number;
};

/**
 * Parse "<input>,<output>" into a TierPrice. Returns null for anything that
 * is not two finite, non-negative numbers, so a typo in config falls back to
 * the default price instead of pricing requests at NaN.
 */
export function parsePriceSpec(spec: string | undefined | null): TierPrice | null {
  if (typeof spec !== 'string') return null;
  const parts = spec.split(',').map((p) => p.trim());
  if (parts.length !== 2 || parts.some((p) => p === '')) return null;
  const [input, output] = parts.map(Number);
  if (!Number.isFinite(input) || !Number.isFinite(output)) return null;
  if (input < 0 || output < 0) return null;
  return { inputPerMillion: input, outputPerMillion: output };
}

// ---------------------------------------------------------------------------
// TierPricing
// ---------------------------------------------------------------------------

export type ConfigReader = (key: string) => string | undefined;

export class TierPricing {
  /**
   * @param config - Config lookup; defaults to `getConfig` (env, then DB,
   *   then CONFIG_KEYS defaults). Injectable so tests can pin prices and
   *   model slugs without touching process.env.
   */
  constructor(private readonly config: ConfigReader = getConfig) {}

  /** The OpenRouter slug the forwarder sends for a tier. */
  modelFor(tier: LlmTier): string {
    const configured = this.config(MODEL_CONFIG_KEY[tier]);
    return configured && configured.trim() !== '' ? configured.trim() : DEFAULT_TIER_MODELS[tier];
  }

  /** The effective price for a tier: configured spec if valid, else the default. */
  price(tier: LlmTier): TierPrice {
    return (
      parsePriceSpec(this.config(PRICE_CONFIG_KEY[tier])) ??
      (parsePriceSpec(DEFAULT_TIER_PRICES[tier]) as TierPrice)
    );
  }

  /**
   * Estimated cost in USD of a request on `tier`. Negative token counts are
   * treated as zero; the result is never negative or NaN.
   */
  costUsd(tier: LlmTier, inputTokens: number, outputTokens: number): number {
    const price = this.price(tier);
    const input = Math.max(0, Number.isFinite(inputTokens) ? inputTokens : 0);
    const output = Math.max(0, Number.isFinite(outputTokens) ? outputTokens : 0);
    return (
      (input * price.inputPerMillion + output * price.outputPerMillion) /
      TOKENS_PER_MILLION
    );
  }

  /**
   * Map the slug actually sent upstream back to its tier. Falls back to
   * MEDIUM for an unknown, empty or missing slug.
   */
  tierFor(modelSent: string | null | undefined): LlmTier {
    if (typeof modelSent !== 'string') return 'medium';
    const wanted = modelSent.trim().toLowerCase();
    if (wanted === '') return 'medium';
    for (const tier of LLM_TIERS) {
      if (this.modelFor(tier).toLowerCase() === wanted) return tier;
    }
    return 'medium';
  }
}
