/**
 * Unit tests for TierPricing (sprint 003 ticket 001): the fallback USD price
 * table used when OpenRouter reports no cost, and the sent-slug → tier map.
 * Pure: config is injected, no database.
 */
import { describe, it, expect } from 'vitest';
import {
  TierPricing,
  parsePriceSpec,
  DEFAULT_TIER_MODELS,
  DEFAULT_TIER_PRICES,
} from '../../../server/src/services/llm-proxy-pricing.js';
import { CONFIG_KEYS } from '../../../server/src/services/config.js';

function configFrom(values: Record<string, string | undefined>) {
  return (key: string) => values[key];
}

describe('parsePriceSpec', () => {
  it('parses "<input>,<output>" in USD per 1M tokens', () => {
    expect(parsePriceSpec('0.28,0.42')).toEqual({ inputPerMillion: 0.28, outputPerMillion: 0.42 });
    expect(parsePriceSpec(' 1 , 2 ')).toEqual({ inputPerMillion: 1, outputPerMillion: 2 });
    expect(parsePriceSpec('0,0')).toEqual({ inputPerMillion: 0, outputPerMillion: 0 });
  });

  it('rejects anything that is not two finite non-negative numbers', () => {
    for (const bad of [undefined, null, '', '1', '1,2,3', 'a,b', '1,', ',2', '-1,2', 'NaN,1', 'Infinity,1']) {
      expect(parsePriceSpec(bad as any), String(bad)).toBeNull();
    }
  });
});

describe('TierPricing defaults', () => {
  it('registers the three price keys in CONFIG_KEYS with the documented defaults', () => {
    for (const [tier, key] of [
      ['large', 'LLM_PROXY_PRICE_LARGE'],
      ['medium', 'LLM_PROXY_PRICE_MEDIUM'],
      ['small', 'LLM_PROXY_PRICE_SMALL'],
    ] as const) {
      const meta = CONFIG_KEYS.find((k) => k.key === key);
      expect(meta, key).toBeDefined();
      expect(meta!.group).toBe('LLM Proxy');
      expect(meta!.defaultValue).toBe(DEFAULT_TIER_PRICES[tier]);
      expect(parsePriceSpec(meta!.defaultValue)).not.toBeNull();
    }
    const budget = CONFIG_KEYS.find((k) => k.key === 'LLM_PROXY_DEFAULT_BUDGET_USD');
    expect(budget?.defaultValue).toBe('5');
  });

  it('uses the default prices and slugs when config is empty', () => {
    const pricing = new TierPricing(configFrom({}));
    expect(pricing.price('large')).toEqual({ inputPerMillion: 0.2088, outputPerMillion: 0.4176 });
    expect(pricing.price('medium')).toEqual({ inputPerMillion: 0.091, outputPerMillion: 0.182 });
    expect(pricing.price('small')).toEqual({ inputPerMillion: 0.28, outputPerMillion: 0.42 });
    expect(pricing.modelFor('large')).toBe(DEFAULT_TIER_MODELS.large);
    expect(pricing.modelFor('small')).toBe('deepseek/deepseek-v3.2');
  });
});

describe('TierPricing.costUsd', () => {
  const pricing = new TierPricing(
    configFrom({
      LLM_PROXY_PRICE_LARGE: '10,20',
      LLM_PROXY_PRICE_MEDIUM: '1,2',
      LLM_PROXY_PRICE_SMALL: '0.5,1',
    }),
  );

  it('charges input and output at the tier rate per 1M tokens', () => {
    // 1,000,000 input at $10 + 500,000 output at $20 = $20
    expect(pricing.costUsd('large', 1_000_000, 500_000)).toBeCloseTo(20, 10);
    // 1000 in at $1/M = 0.001, 500 out at $2/M = 0.001
    expect(pricing.costUsd('medium', 1000, 500)).toBeCloseTo(0.002, 12);
    expect(pricing.costUsd('small', 2000, 2000)).toBeCloseTo(0.003, 12);
  });

  it('never returns a negative or NaN cost', () => {
    expect(pricing.costUsd('medium', -100, -5)).toBe(0);
    expect(pricing.costUsd('medium', Number.NaN, 10)).toBeCloseTo(0.00002, 12);
    expect(pricing.costUsd('medium', 0, 0)).toBe(0);
  });

  it('falls back to the default price when the configured spec is malformed', () => {
    const broken = new TierPricing(configFrom({ LLM_PROXY_PRICE_SMALL: 'cheap' }));
    expect(broken.price('small')).toEqual({ inputPerMillion: 0.28, outputPerMillion: 0.42 });
    expect(broken.costUsd('small', 1_000_000, 0)).toBeCloseTo(0.28, 10);
  });
});

describe('TierPricing.tierFor', () => {
  it('maps the default slugs back to their tiers, case-insensitively', () => {
    const pricing = new TierPricing(configFrom({}));
    expect(pricing.tierFor('deepseek/deepseek-v4-pro')).toBe('large');
    expect(pricing.tierFor('deepseek/deepseek-v4-flash')).toBe('medium');
    expect(pricing.tierFor('deepseek/deepseek-v3.2')).toBe('small');
    expect(pricing.tierFor('  DeepSeek/DeepSeek-V3.2 ')).toBe('small');
  });

  it('honours LLM_PROXY_MODEL_* overrides', () => {
    const pricing = new TierPricing(
      configFrom({
        LLM_PROXY_MODEL_LARGE: 'anthropic/claude-opus-4',
        LLM_PROXY_MODEL_SMALL: 'openai/gpt-5-nano',
      }),
    );
    expect(pricing.tierFor('anthropic/claude-opus-4')).toBe('large');
    expect(pricing.tierFor('openai/gpt-5-nano')).toBe('small');
    // The default large slug is no longer large once overridden.
    expect(pricing.tierFor('deepseek/deepseek-v4-pro')).toBe('medium');
  });

  it('falls back to MEDIUM for unknown, empty or missing slugs', () => {
    const pricing = new TierPricing(configFrom({}));
    expect(pricing.tierFor('some/unpriced-model')).toBe('medium');
    expect(pricing.tierFor('')).toBe('medium');
    expect(pricing.tierFor(null)).toBe('medium');
    expect(pricing.tierFor(undefined)).toBe('medium');
  });
});
