/**
 * OpenCode — a custom `league` provider in ~/.config/opencode/opencode.json
 * using the OpenAI-compatible AI SDK adapter, with every tier listed.
 */
import { tier, type ExampleBuilder } from './types';

export const opencode: ExampleBuilder = ({ endpoint, token, models }) => {
  const modelEntries = Object.fromEntries(models.map((id) => [id, { name: id }]));
  const config = {
    $schema: 'https://opencode.ai/config.json',
    provider: {
      league: {
        npm: '@ai-sdk/openai-compatible',
        name: 'League',
        options: {
          baseURL: `${endpoint}/v1`,
          apiKey: token,
        },
        models: modelEntries,
      },
    },
    model: `league/${tier(models, 'medium')}`,
  };
  return {
    title: 'OpenCode',
    body: `// ~/.config/opencode/opencode.json\n${JSON.stringify(config, null, 2)}`,
    howToTest:
      'Start `opencode` in a project; the status line should show the League model, and a prompt should answer.',
  };
};

export default opencode;
