/**
 * Hermes Agent — `model:` block for ~/.hermes/config.yaml plus the key.
 *
 * Caveat (carried into the rendered text): Hermes's config keys change
 * between releases; verify `provider`/`base_url`/`default` and the
 * OPENAI_API_KEY setting name against the Hermes docs for your version.
 */
import { tier, type ExampleBuilder } from './types';

export const hermes: ExampleBuilder = ({ endpoint, token, models }) => {
  const body = [
    `# ~/.hermes/config.yaml`,
    `model:`,
    `  provider: custom`,
    `  base_url: ${endpoint}/v1`,
    `  default: ${tier(models, 'medium')}`,
    ``,
    `# Then store the token (run once):`,
    `hermes config set OPENAI_API_KEY ${token}`,
    ``,
    `# Note: key names vary by Hermes version — check the Hermes docs if it rejects this config.`,
  ].join('\n');
  return {
    title: 'Hermes Agent',
    body,
    howToTest: 'Run `hermes chat` and send "hi"; a reply means the proxy is working.',
  };
};

export default hermes;
