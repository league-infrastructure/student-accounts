/**
 * Claude Code via the Anthropic-compatible surface (`POST /proxy/v1/messages`).
 *
 * Claude Code reads ANTHROPIC_BASE_URL and appends `/v1/messages` itself, so
 * the base is `<origin>/proxy`, not `/proxy/v1`. ANTHROPIC_API_KEY is set to
 * the empty string so a key lingering in the shell cannot override the
 * League token, which travels as ANTHROPIC_AUTH_TOKEN (Bearer).
 */
import { tier, type ExampleBuilder } from './types';

export const claudeCode: ExampleBuilder = ({ endpoint, token, models, anthropicEndpoint }) => {
  const base = anthropicEndpoint ?? endpoint;
  const body = [
    `export ANTHROPIC_BASE_URL="${base}"`,
    `export ANTHROPIC_AUTH_TOKEN="${token}"`,
    `export ANTHROPIC_API_KEY=""`,
    `export ANTHROPIC_MODEL="${tier(models, 'large')}"`,
    `export ANTHROPIC_SMALL_FAST_MODEL="${tier(models, 'small')}"`,
    `claude`,
  ].join('\n');
  return {
    title: 'Claude Code',
    body,
    howToTest:
      'Paste the lines into a terminal, then run `claude -p "say hi"`. A one-line reply means the proxy is working.',
  };
};

export default claudeCode;
