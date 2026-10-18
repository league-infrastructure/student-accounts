/**
 * Continue (VS Code / JetBrains) — a `models:` entry for ~/.continue/config.yaml.
 */
import { tier, type ExampleBuilder } from './types';

export const continueDev: ExampleBuilder = ({ endpoint, token, models }) => {
  const body = [
    `# ~/.continue/config.yaml — add under "models:"`,
    `models:`,
    `  - name: League`,
    `    provider: openai`,
    `    apiBase: ${endpoint}/v1`,
    `    apiKey: ${token}`,
    `    model: ${tier(models, 'medium')}`,
    `    roles: [chat, edit, apply]`,
  ].join('\n');
  return {
    title: 'Continue',
    body,
    howToTest:
      'Reload VS Code, pick "League" in the Continue model menu, and send "hi" in the chat panel.',
  };
};

export default continueDev;
