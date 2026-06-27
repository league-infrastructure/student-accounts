/**
 * LlmProxyUsage — the "Connect your AI client" setup snippets for the student
 * LLM proxy view (shared by /llm-proxy and the /account card so they can't
 * drift).
 *
 * Renders two independently copy-pasteable code blocks:
 *   - OpenAI-compatible client setup — environment variables for any
 *     OpenAI-compatible client (e.g. Continue).
 *   - curl example — inline test against the proxy.
 */

import { useState } from 'react';

function openAiSnippet(endpoint: string, token: string): string {
  return `# OpenAI-compatible client setup
export OPENAI_BASE_URL="${endpoint}/v1"
export OPENAI_API_KEY="${token}"
# League model tiers (choose one):
#   league-large   — most capable
#   league-medium  — balanced (recommended)
#   league-small   — fast and lightweight`;
}

function curlSnippet(endpoint: string, token: string): string {
  return `# curl — use league-medium, league-large, or league-small
curl -X POST "${endpoint}/v1/chat/completions" \\
  -H "Authorization: Bearer ${token}" \\
  -H "Content-Type: application/json" \\
  -d '{"model":"league-medium","messages":[{"role":"user","content":"hi"}]}'`;
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
      <CodeBlock code={openAiSnippet(endpoint, token)} label="OpenAI-compatible client setup" />
      <div style={styles.curlBlock}>
        <CodeBlock code={curlSnippet(endpoint, token)} label="curl example" />
      </div>
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
  curlBlock: { marginTop: '0.75rem' },
};
