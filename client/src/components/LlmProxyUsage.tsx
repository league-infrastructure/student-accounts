/**
 * LlmProxyUsage — the "Connect your AI client" setup snippets for the student
 * LLM proxy view (shared by /llm-proxy and the admin user card so they can't
 * drift).
 *
 * The proxy speaks the OpenAI chat/completions API (it forwards to
 * OpenRouter upstream), so students connect with an OpenAI-compatible
 * client. We document Continue (https://continue.dev) — a VS Code /
 * JetBrains extension — as the supported client.
 *
 * Renders two independently copy-pasteable code blocks:
 *   - Continue config — a model entry for ~/.continue/config.json.
 *   - curl example — inline test against the proxy.
 */

import { useState } from 'react';

function continueSnippet(endpoint: string, token: string): string {
  return `{
  "title": "League",
  "provider": "openai",
  "apiBase": "${endpoint}/v1",
  "apiKey": "${token}",
  "model": "league-medium"
}`;
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
      <p style={styles.note}>
        Add this entry to the <code>models</code> array in your Continue
        config (<code>~/.continue/config.json</code>):
      </p>
      <CodeBlock code={continueSnippet(endpoint, token)} label="Continue config" />
      <p style={styles.note}>
        Model tiers: <code>league-large</code> (most capable) ·{' '}
        <code>league-medium</code> (balanced) · <code>league-small</code> (fast).
      </p>
      <div style={styles.curlBlock}>
        <CodeBlock code={curlSnippet(endpoint, token)} label="curl example" />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  note: { color: '#475569', fontSize: '0.85rem', margin: '0.5rem 0 0.25rem' },
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
