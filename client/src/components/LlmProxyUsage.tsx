/**
 * LlmProxyUsage — the "Using your token" setup snippets for the student LLM
 * proxy view (shared by /llm-proxy and the /account card so they can't drift).
 *
 * Renders two independently copy-pasteable code blocks:
 *   - Claude Code — always shown, with a Copy button.
 *   - curl example — collapsed by default behind a <details> disclosure
 *     (the rotating triangle), with its own Copy button.
 */

import { useState } from 'react';

function claudeSnippet(endpoint: string, token: string): string {
  return `# Claude Code
export ANTHROPIC_BASE_URL="${endpoint}"
export ANTHROPIC_API_KEY="${token}"
# Allowed models: Sonnet or Haiku (specified in the request model field)
export ANTHROPIC_MODEL="claude-sonnet-4-6"
export ANTHROPIC_SMALL_FAST_MODEL="claude-haiku-4-5-20251001"
claude --dangerously-skip-permissions`;
}

function curlSnippet(endpoint: string, token: string): string {
  return `# curl — the proxy automatically maps model strings to allowed versions
# Any string containing "Sonnet" → claude-sonnet-4-6
# Any string containing "Haiku" → claude-haiku-4-5-20251001
curl -X POST "${endpoint}/v1/messages" \\
  -H "x-api-key: ${token}" \\
  -H "anthropic-version: 2023-06-01" \\
  -H "content-type: application/json" \\
  -d '{"model":"claude-sonnet-4-6","max_tokens":1024,
       "messages":[{"role":"user","content":"hi"}]}'`;
}

/** A dark code block with a top-right copy-to-clipboard button. */
function CodeBlock({ code, label }: { code: string; label: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  return (
    <div style={styles.wrap}>
      <button
        type="button"
        onClick={copy}
        style={styles.copyBtn}
        aria-label={`Copy ${label} to clipboard`}
      >
        {copied ? 'Copied' : 'Copy'}
      </button>
      <pre style={styles.pre}>{code}</pre>
    </div>
  );
}

export default function LlmProxyUsage({
  endpoint,
  token,
}: {
  endpoint: string;
  token: string;
}) {
  return (
    <div>
      <CodeBlock code={claudeSnippet(endpoint, token)} label="Claude Code setup" />
      <details style={styles.details}>
        <summary style={styles.summary}>curl example</summary>
        <CodeBlock code={curlSnippet(endpoint, token)} label="curl example" />
      </details>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  wrap: { position: 'relative', margin: '0.25rem 0' },
  copyBtn: {
    position: 'absolute',
    top: 8,
    right: 8,
    fontSize: '0.75rem',
    padding: '0.15rem 0.55rem',
    border: '1px solid #334155',
    borderRadius: 4,
    background: '#1e293b',
    color: '#e2e8f0',
    cursor: 'pointer',
    zIndex: 1,
  },
  pre: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.8rem',
    background: '#0f172a',
    color: '#e2e8f0',
    padding: '1.9rem 0.8rem 0.8rem',
    borderRadius: 6,
    overflowX: 'auto',
    margin: 0,
  },
  details: { marginTop: '0.75rem' },
  summary: {
    cursor: 'pointer',
    fontSize: '0.85rem',
    fontWeight: 600,
    color: '#334155',
    padding: '0.25rem 0',
    userSelect: 'none',
  },
};
