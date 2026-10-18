/**
 * curl against the OpenAI-compatible surface: one chat completion on the
 * medium tier and one listing of the tiers.
 */
import { tier, type ExampleBuilder } from './types';

export const curl: ExampleBuilder = ({ endpoint, token, models }) => {
  const model = tier(models, 'medium');
  const body = [
    `# Chat completion (${models.join(', ')})`,
    `curl -X POST "${endpoint}/v1/chat/completions" \\`,
    `  -H "Authorization: Bearer ${token}" \\`,
    `  -H "Content-Type: application/json" \\`,
    `  -d '{"model":"${model}","messages":[{"role":"user","content":"Say hi in five words."}]}'`,
    ``,
    `# List the League model tiers`,
    `curl "${endpoint}/v1/models" \\`,
    `  -H "Authorization: Bearer ${token}"`,
  ].join('\n');
  return {
    title: 'curl',
    body,
    howToTest:
      'The first command prints JSON with a `choices[0].message.content` reply; the second lists the three tiers.',
  };
};

export default curl;
