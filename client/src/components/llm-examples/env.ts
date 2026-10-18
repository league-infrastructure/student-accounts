/**
 * Generic environment variables for any OpenAI-compatible tool.
 */
import type { ExampleBuilder } from './types';

export const env: ExampleBuilder = ({ endpoint, token, models }) => {
  const body = [
    `export OPENAI_BASE_URL="${endpoint}/v1"`,
    `export OPENAI_API_KEY="${token}"`,
    ``,
    `# Model names (most capable first):`,
    ...models.map((m) => `#   ${m}`),
  ].join('\n');
  return {
    title: 'Environment variables',
    body,
    howToTest:
      'Paste into your shell, then run any OpenAI-compatible tool and pick one of the model names above.',
  };
};

export default env;
