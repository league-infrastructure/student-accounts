/**
 * Tests for LlmProxySetupExamples (sprint 003, ticket 004).
 *
 *  - Renders one tab per tool; Claude Code only when anthropicEnabled.
 *  - Every example body carries the real token and endpoint.
 *  - Copy puts the exact example text on the clipboard.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import LlmProxySetupExamples from '../../client/src/components/LlmProxySetupExamples';
import { EXAMPLES } from '../../client/src/components/llm-examples';

const endpoint = 'https://accounts.example.org/proxy';
const token = 'llmp_testtoken_0123456789abcdef';
const models = ['league-large', 'league-medium', 'league-small'];

let writeText: ReturnType<typeof vi.fn>;

beforeEach(() => {
  writeText = vi.fn(async () => {});
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText },
    configurable: true,
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('LlmProxySetupExamples — tabs', () => {
  it('renders seven tabs when the Anthropic surface is enabled, Claude Code first', () => {
    render(
      <LlmProxySetupExamples
        endpoint={endpoint}
        token={token}
        models={models}
        anthropicEnabled
        anthropicEndpoint={endpoint}
      />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(7);
    expect(tabs[0]).toHaveTextContent('Claude Code');
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('llm-example-body-claude-code')).toHaveTextContent(
      'ANTHROPIC_AUTH_TOKEN',
    );
  });

  it('hides the Claude Code tab when anthropicEnabled is false', () => {
    render(
      <LlmProxySetupExamples endpoint={endpoint} token={token} models={models} anthropicEnabled={false} />,
    );
    const tabs = screen.getAllByRole('tab');
    expect(tabs).toHaveLength(6);
    expect(screen.queryByRole('tab', { name: /claude code/i })).toBeNull();
    expect(tabs[0]).toHaveTextContent('curl');
    expect(screen.queryByText(/ANTHROPIC_/)).toBeNull();
  });

  it('every tab shows a body with the token and the endpoint and a how-to-test line', () => {
    render(
      <LlmProxySetupExamples
        endpoint={endpoint}
        token={token}
        models={models}
        anthropicEnabled
        anthropicEndpoint={endpoint}
      />,
    );
    for (const entry of EXAMPLES) {
      fireEvent.click(screen.getByTestId(`llm-example-tab-${entry.id}`));
      const body = screen.getByTestId(`llm-example-body-${entry.id}`);
      expect(body.textContent).toContain(token);
      expect(body.textContent).toContain(endpoint);
      expect(screen.getByText(/how to test:/i)).toBeInTheDocument();
    }
  });
});

describe('LlmProxySetupExamples — Copy', () => {
  it('writes the exact template text for the active tab to the clipboard', async () => {
    render(
      <LlmProxySetupExamples
        endpoint={endpoint}
        token={token}
        models={models}
        anthropicEnabled
        anthropicEndpoint={endpoint}
      />,
    );
    const expected = EXAMPLES[0].build({ endpoint, token, models, anthropicEndpoint: endpoint }).body;

    fireEvent.click(screen.getByRole('button', { name: /copy claude code example/i }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith(expected);
    expect(screen.getByRole('button', { name: /copy claude code example/i })).toHaveTextContent(
      'Copied',
    );
  });

  it('copies the selected tool after switching tabs', async () => {
    render(
      <LlmProxySetupExamples endpoint={endpoint} token={token} models={models} anthropicEnabled={false} />,
    );
    fireEvent.click(screen.getByTestId('llm-example-tab-python'));
    fireEvent.click(screen.getByRole('button', { name: /copy python example/i }));
    const expected = EXAMPLES.find((e) => e.id === 'python')!.build({ endpoint, token, models }).body;
    await waitFor(() => expect(writeText).toHaveBeenCalledWith(expected));
    expect(expected).toContain('from openai import OpenAI');
  });

  it('falls back to the default tier names when models is empty', () => {
    render(<LlmProxySetupExamples endpoint={endpoint} token={token} models={[]} />);
    fireEvent.click(screen.getByTestId('llm-example-tab-curl'));
    expect(screen.getByTestId('llm-example-body-curl')).toHaveTextContent('league-medium');
  });
});
