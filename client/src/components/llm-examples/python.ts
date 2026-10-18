/**
 * Python with the OpenAI SDK (`pip install openai`), pointed at the proxy.
 */
import { tier, type ExampleBuilder } from './types';

export const python: ExampleBuilder = ({ endpoint, token, models }) => {
  const body = [
    `# pip install openai`,
    `from openai import OpenAI`,
    ``,
    `client = OpenAI(base_url="${endpoint}/v1", api_key="${token}")`,
    ``,
    `resp = client.chat.completions.create(`,
    `    model="${tier(models, 'medium')}",  # or ${models.filter((m) => m !== tier(models, 'medium')).join(', ')}`,
    `    messages=[{"role": "user", "content": "Say hi in five words."}],`,
    `)`,
    `print(resp.choices[0].message.content)`,
  ].join('\n');
  return {
    title: 'Python',
    body,
    howToTest: 'Run the script; it prints a short reply.',
  };
};

export default python;
