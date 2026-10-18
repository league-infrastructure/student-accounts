/**
 * LlmProxySetupExamples — the tabbed "connect your tool" examples for the
 * LLM proxy, rendered with the student's real token and endpoint
 * (sprint 003, ticket 004).
 *
 * Shared by the student /llm-proxy page and the admin's view of a student
 * so both show identical instructions. The text itself comes from the pure
 * template functions in ./llm-examples; this component only lays them out
 * and copies them. The Claude Code tab appears only when the server's
 * Anthropic-compatible surface is on (`anthropicEnabled`).
 */

import { useState } from 'react';
import { EXAMPLES, modelsOrDefault, type SetupExample } from './llm-examples';

export interface LlmProxySetupExamplesProps {
  endpoint: string;
  token: string;
  models?: readonly string[] | null;
  anthropicEnabled?: boolean;
  anthropicEndpoint?: string | null;
}

interface BuiltExample extends SetupExample {
  id: string;
}

export default function LlmProxySetupExamples({
  endpoint,
  token,
  models,
  anthropicEnabled = false,
  anthropicEndpoint,
}: LlmProxySetupExamplesProps) {
  const ctx = {
    endpoint,
    token,
    models: modelsOrDefault(models),
    anthropicEndpoint: anthropicEnabled ? (anthropicEndpoint ?? endpoint) : undefined,
  };
  const examples: BuiltExample[] = EXAMPLES.filter(
    (e) => !e.requiresAnthropic || anthropicEnabled,
  ).map((e) => ({ id: e.id, ...e.build(ctx) }));

  const [activeId, setActiveId] = useState<string>(examples[0]?.id ?? '');
  const active = examples.find((e) => e.id === activeId) ?? examples[0];
  const [copiedId, setCopiedId] = useState<string | null>(null);

  async function copy(example: BuiltExample) {
    try {
      await navigator.clipboard.writeText(example.body);
      setCopiedId(example.id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {
      /* clipboard unavailable — ignore */
    }
  }

  if (!active) return null;

  return (
    <div data-testid="llm-proxy-setup-examples">
      <div role="tablist" aria-label="Setup examples" style={styles.tablist}>
        {examples.map((e) => {
          const selected = e.id === active.id;
          return (
            <button
              key={e.id}
              type="button"
              role="tab"
              id={`llm-example-tab-${e.id}`}
              aria-selected={selected}
              aria-controls={`llm-example-panel-${e.id}`}
              data-testid={`llm-example-tab-${e.id}`}
              onClick={() => setActiveId(e.id)}
              style={{ ...styles.tab, ...(selected ? styles.tabActive : null) }}
            >
              {e.title}
            </button>
          );
        })}
      </div>

      <section
        role="tabpanel"
        id={`llm-example-panel-${active.id}`}
        aria-labelledby={`llm-example-tab-${active.id}`}
        data-testid={`llm-example-panel-${active.id}`}
        style={styles.panel}
      >
        <div style={styles.panelHeader}>
          <h3 style={styles.title}>{active.title}</h3>
          <button
            type="button"
            onClick={() => copy(active)}
            style={styles.copyBtn}
            aria-label={`Copy ${active.title} example`}
          >
            {copiedId === active.id ? 'Copied' : 'Copy'}
          </button>
        </div>
        <pre data-testid={`llm-example-body-${active.id}`} style={styles.pre}>
          {active.body}
        </pre>
        <p style={styles.howToTest}>
          <strong>How to test:</strong> {active.howToTest}
        </p>
      </section>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  tablist: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    borderBottom: '1px solid #e2e8f0',
    marginBottom: '0.75rem',
  },
  tab: {
    fontSize: '0.85rem',
    padding: '0.4rem 0.75rem',
    borderTop: '1px solid transparent',
    borderLeft: '1px solid transparent',
    borderRight: '1px solid transparent',
    borderBottom: 'none',
    borderRadius: '6px 6px 0 0',
    background: 'transparent',
    color: '#475569',
    cursor: 'pointer',
  },
  tabActive: {
    borderTop: '1px solid #e2e8f0',
    borderLeft: '1px solid #e2e8f0',
    borderRight: '1px solid #e2e8f0',
    background: '#f8fafc',
    color: '#1e293b',
    fontWeight: 600,
    marginBottom: -1,
  },
  panel: { margin: 0 },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    marginBottom: '0.4rem',
  },
  title: {
    fontSize: '0.95rem',
    fontWeight: 600,
    margin: 0,
    color: '#334155',
  },
  copyBtn: {
    fontSize: '0.8rem',
    padding: '0.15rem 0.6rem',
    border: '1px solid #cbd5e1',
    borderRadius: 4,
    background: '#f8fafc',
    cursor: 'pointer',
  },
  pre: {
    fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
    fontSize: '0.8rem',
    background: '#0f172a',
    color: '#e2e8f0',
    padding: '0.8rem',
    borderRadius: 6,
    overflowX: 'auto',
    margin: 0,
    whiteSpace: 'pre',
  },
  howToTest: {
    color: '#475569',
    fontSize: '0.85rem',
    margin: '0.5rem 0 0',
  },
};
