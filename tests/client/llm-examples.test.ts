/**
 * Template tests for client/src/components/llm-examples (sprint 003, ticket 004).
 *
 * Every template is a pure function; each one must carry the student's real
 * token and endpoint, name only League tiers (never a vendor model), and
 * stay stable (snapshot). The Claude Code template must set both Anthropic
 * variables the way Claude Code expects.
 */
import { describe, it, expect } from 'vitest';
import {
  EXAMPLES,
  claudeCode,
  curl,
  continueDev,
  opencode,
  hermes,
  python,
  env,
  tier,
  modelsOrDefault,
  DEFAULT_LEAGUE_MODELS,
  type ExampleContext,
} from '../../client/src/components/llm-examples';

const ctx: ExampleContext = {
  endpoint: 'https://accounts.example.org/proxy',
  token: 'llmp_testtoken_0123456789abcdef',
  models: ['league-large', 'league-medium', 'league-small'],
  anthropicEndpoint: 'https://accounts.example.org/proxy',
};

describe('llm-examples registry', () => {
  it('lists the seven tools in display order, Claude Code first and Anthropic-gated', () => {
    expect(EXAMPLES.map((e) => e.id)).toEqual([
      'claude-code',
      'curl',
      'continue',
      'opencode',
      'hermes',
      'python',
      'env',
    ]);
    expect(EXAMPLES[0].requiresAnthropic).toBe(true);
    expect(EXAMPLES.slice(1).every((e) => !e.requiresAnthropic)).toBe(true);
  });

  it.each(EXAMPLES.map((e) => [e.id, e] as const))(
    '%s contains the token and the endpoint, a title and a how-to-test line',
    (_id, entry) => {
      const ex = entry.build(ctx);
      expect(ex.title.length).toBeGreaterThan(0);
      expect(ex.howToTest.length).toBeGreaterThan(0);
      expect(ex.body).toContain(ctx.token);
      expect(ex.body).toContain(ctx.endpoint);
    },
  );

  it.each(EXAMPLES.map((e) => [e.id, e] as const))(
    '%s names only League tiers, never a vendor model',
    (_id, entry) => {
      const { body } = entry.build(ctx);
      expect(body).toMatch(/league-(small|medium|large)/);
      expect(body).not.toMatch(/deepseek|gpt-|claude-\d|sonnet|opus|haiku|gemini|llama/i);
    },
  );

  it.each(EXAMPLES.map((e) => [e.id, e] as const))('%s matches its snapshot', (_id, entry) => {
    expect(entry.build(ctx)).toMatchSnapshot();
  });
});

describe('claude-code template', () => {
  it('sets both ANTHROPIC auth variables, the tier models, and ends with `claude`', () => {
    const { body } = claudeCode(ctx);
    const lines = body.split('\n');
    expect(lines).toEqual([
      'export ANTHROPIC_BASE_URL="https://accounts.example.org/proxy"',
      `export ANTHROPIC_AUTH_TOKEN="${ctx.token}"`,
      'export ANTHROPIC_API_KEY=""',
      'export ANTHROPIC_MODEL="league-large"',
      'export ANTHROPIC_SMALL_FAST_MODEL="league-small"',
      'claude',
    ]);
  });

  it('falls back to the OpenAI base when no anthropicEndpoint is given', () => {
    const { body } = claudeCode({ ...ctx, anthropicEndpoint: undefined });
    expect(body).toContain('export ANTHROPIC_BASE_URL="https://accounts.example.org/proxy"');
  });
});

describe('curl template', () => {
  it('posts to /v1/chat/completions with league-medium and lists /v1/models', () => {
    const { body } = curl(ctx);
    expect(body).toContain(`"${ctx.endpoint}/v1/chat/completions"`);
    expect(body).toContain(`Authorization: Bearer ${ctx.token}`);
    expect(body).toContain('"model":"league-medium"');
    expect(body).toContain(`"${ctx.endpoint}/v1/models"`);
  });
});

describe('continue template', () => {
  it('is a config.yaml models entry with provider openai, apiBase <endpoint>/v1 and roles', () => {
    const { body } = continueDev(ctx);
    expect(body).toContain('~/.continue/config.yaml');
    expect(body).toContain('provider: openai');
    expect(body).toContain(`apiBase: ${ctx.endpoint}/v1`);
    expect(body).toContain(`apiKey: ${ctx.token}`);
    expect(body).toContain('model: league-medium');
    expect(body).toContain('roles: [chat, edit, apply]');
  });
});

describe('opencode template', () => {
  it('defines a league provider on @ai-sdk/openai-compatible with all three tiers', () => {
    const { body } = opencode(ctx);
    const json = JSON.parse(body.replace(/^\/\/.*\n/, ''));
    expect(json.provider.league.npm).toBe('@ai-sdk/openai-compatible');
    expect(json.provider.league.options.baseURL).toBe(`${ctx.endpoint}/v1`);
    expect(json.provider.league.options.apiKey).toBe(ctx.token);
    expect(Object.keys(json.provider.league.models)).toEqual(ctx.models);
    expect(json.model).toBe('league/league-medium');
  });
});

describe('hermes template', () => {
  it('has the custom provider block, the config set command and the docs caveat', () => {
    const { body } = hermes(ctx);
    expect(body).toContain('~/.hermes/config.yaml');
    expect(body).toContain('provider: custom');
    expect(body).toContain(`base_url: ${ctx.endpoint}/v1`);
    expect(body).toContain('default: league-medium');
    expect(body).toContain(`hermes config set OPENAI_API_KEY ${ctx.token}`);
    expect(body).toMatch(/Hermes docs/);
  });
});

describe('python template', () => {
  it('constructs the OpenAI client against the proxy and uses league-medium', () => {
    const { body } = python(ctx);
    expect(body).toContain('from openai import OpenAI');
    expect(body).toContain(`OpenAI(base_url="${ctx.endpoint}/v1", api_key="${ctx.token}")`);
    expect(body).toContain('model="league-medium"');
  });
});

describe('env template', () => {
  it('exports OPENAI_BASE_URL and OPENAI_API_KEY and lists every tier', () => {
    const { body } = env(ctx);
    expect(body).toContain(`export OPENAI_BASE_URL="${ctx.endpoint}/v1"`);
    expect(body).toContain(`export OPENAI_API_KEY="${ctx.token}"`);
    for (const m of ctx.models) expect(body).toContain(m);
  });
});

describe('tier helpers', () => {
  it('tier() picks from the server list and falls back to league-<size>', () => {
    expect(tier(['x-large', 'x-medium', 'x-small'], 'medium')).toBe('x-medium');
    expect(tier([], 'large')).toBe('league-large');
  });

  it('modelsOrDefault() uses the defaults for an empty or missing list', () => {
    expect(modelsOrDefault(undefined)).toEqual([...DEFAULT_LEAGUE_MODELS]);
    expect(modelsOrDefault([])).toEqual([...DEFAULT_LEAGUE_MODELS]);
    expect(modelsOrDefault(['a'])).toEqual(['a']);
  });

  it('templates render the server-supplied names when tiers are renamed', () => {
    const renamed = { ...ctx, models: ['tier-large', 'tier-medium', 'tier-small'] };
    expect(curl(renamed).body).toContain('"model":"tier-medium"');
    expect(claudeCode(renamed).body).toContain('ANTHROPIC_MODEL="tier-large"');
  });
});
