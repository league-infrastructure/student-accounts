/**
 * LlmProxyForwarderService — Anthropic Messages API forwarder (Sprint 013 T003).
 *
 * Responsibilities:
 *  - Hold the server-side Anthropic API key.
 *  - Forward POST /proxy/v1/messages → https://api.anthropic.com/v1/messages
 *    using fetch, preserving streaming (SSE).
 *  - Report token usage to the caller via an `onUsage` callback after the
 *    request completes so the caller can update `LlmProxyToken` counters.
 *
 * Security invariants:
 *  - The client-supplied Authorization header is stripped. The real API key
 *    never leaves the server.
 *  - The client-supplied x-api-key header is also stripped.
 *  - The `anthropic-beta` header is passed through (newer Claude Code
 *    builds rely on it).
 *
 * Streaming:
 *  - Bytes are piped from the upstream ReadableStream to `res.write(chunk)`
 *    as they arrive — no buffering of the whole response.
 *  - SSE events are parsed in-flight to extract `usage.output_tokens` from
 *    `message_delta` events and `usage.input_tokens` from `message_start`.
 *    These drive the `onUsage` callback after the stream finishes.
 *  - Client disconnects (`res.on('close')`) abort the upstream fetch via
 *    AbortController so we stop consuming Anthropic tokens when the client
 *    has gone.
 */

import type { Request, Response } from 'express';
import { AppError } from '../errors.js';
import { createLogger } from './logger.js';

const logger = createLogger('llm-proxy-forwarder');

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ANTHROPIC_MESSAGES_URL = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the server has no Anthropic API key configured. The route
 * layer translates this to HTTP 503.
 */
export class LlmProxyNotConfiguredError extends AppError {
  constructor(
    message = 'LLM proxy is not configured: ANTHROPIC_API_KEY (or LLM_PROXY_ANTHROPIC_API_KEY) is missing.',
  ) {
    super(message, 503);
    this.name = 'LlmProxyNotConfiguredError';
  }
}

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

export type ForwardOptions = {
  /**
   * Called once after the upstream request (and, for streaming, after the
   * stream completes) with the usage numbers extracted from the response.
   * Callers use this to update LlmProxyToken counters.
   */
  onUsage: (inputTokens: number, outputTokens: number) => void;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the API key from the same env var precedence used at construction.
 * Exported for the route layer's 503-check.
 */
export function resolveLlmProxyApiKey(): string {
  return (
    process.env.LLM_PROXY_ANTHROPIC_API_KEY ??
    process.env.ANTHROPIC_API_KEY ??
    ''
  );
}

/**
 * Parse SSE event bytes looking for `data: {...}` lines and invoke the
 * callback with the parsed JSON payload. Handles multi-line events.
 */
function parseSseEvents(
  buffer: string,
  onEvent: (payload: Record<string, unknown>) => void,
): string {
  // SSE events are separated by blank lines (\n\n). Split and keep the
  // trailing (possibly incomplete) segment in the buffer.
  const events = buffer.split(/\r?\n\r?\n/);
  const remainder = events.pop() ?? '';
  for (const event of events) {
    // Each event has one or more `data: ...` lines. Concatenate the
    // data lines for a single JSON payload.
    const dataLines: string[] = [];
    for (const line of event.split(/\r?\n/)) {
      if (line.startsWith('data: ')) {
        dataLines.push(line.slice('data: '.length));
      } else if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length));
      }
    }
    if (dataLines.length === 0) continue;
    const data = dataLines.join('\n').trim();
    if (!data || data === '[DONE]') continue;
    try {
      const payload = JSON.parse(data) as Record<string, unknown>;
      onEvent(payload);
    } catch {
      // Non-JSON data lines are ignored — Anthropic does send plain
      // comment frames in some cases.
    }
  }
  return remainder;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

export class LlmProxyForwarderService {
  private readonly apiKey: string;

  constructor(apiKey: string = resolveLlmProxyApiKey()) {
    this.apiKey = apiKey;
  }

  /**
   * Is the service ready to forward? Consumed by the route layer so the
   * handler can return 503 up-front without trying a fetch.
   */
  isConfigured(): boolean {
    return this.apiKey.length > 0;
  }

  /**
   * Forward the given request to Anthropic and write the response into the
   * caller's Express response. Preserves streaming.
   */
  async forwardMessages(
    req: Request,
    res: Response,
    opts: ForwardOptions,
  ): Promise<void> {
    if (!this.apiKey) {
      throw new LlmProxyNotConfiguredError();
    }

    const body = req.body ?? {};
    const isStream = body && typeof body === 'object' && body.stream === true;

    // Build upstream headers. Strip any client-supplied auth.
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'x-api-key': this.apiKey,
      'anthropic-version': ANTHROPIC_VERSION,
    };
    const beta = req.header('anthropic-beta');
    if (beta) headers['anthropic-beta'] = beta;

    const controller = new AbortController();
    // If the client hangs up, abort the upstream so we stop consuming
    // Anthropic tokens.
    const abortOnClose = () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };
    res.once('close', abortOnClose);

    let upstream: Response;
    try {
      upstream = (await fetch(ANTHROPIC_MESSAGES_URL, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      })) as unknown as Response;
    } catch (err) {
      res.off('close', abortOnClose);
      if ((err as any)?.name === 'AbortError') {
        logger.debug({ err }, '[llm-proxy-forwarder] client disconnected during upstream fetch');
        if (!res.writableEnded) {
          try {
            res.end();
          } catch {
            /* ignore */
          }
        }
        return;
      }
      logger.warn({ err }, '[llm-proxy-forwarder] upstream fetch failed');
      if (!res.headersSent) {
        res.status(502).json({
          error: 'Upstream Anthropic request failed',
          detail: (err as Error)?.message ?? String(err),
        });
      } else if (!res.writableEnded) {
        try {
          res.end();
        } catch {
          /* ignore */
        }
      }
      try {
        opts.onUsage(0, 0);
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      if (isStream) {
        await this.pipeStreaming(upstream, res, opts);
      } else {
        await this.pipeJson(upstream, res, opts);
      }
    } finally {
      res.off('close', abortOnClose);
    }
  }

  // --------------------------------------------------------------------
  // Non-streaming path
  // --------------------------------------------------------------------

  private async pipeJson(
    upstream: Response,
    res: Response,
    opts: ForwardOptions,
  ): Promise<void> {
    const text = await upstream.text();
    const status = upstream.status;

    res.status(status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    res.send(text);

    let inputTokens = 0;
    let outputTokens = 0;
    if (upstream.ok) {
      try {
        const parsed = JSON.parse(text) as any;
        const usage = parsed?.usage;
        if (usage && typeof usage === 'object') {
          inputTokens = Number(usage.input_tokens ?? 0) || 0;
          outputTokens = Number(usage.output_tokens ?? 0) || 0;
        }
      } catch {
        // Non-JSON body (unlikely for Anthropic) — report zero tokens.
      }
    }
    try {
      opts.onUsage(inputTokens, outputTokens);
    } catch (err) {
      logger.warn({ err }, '[llm-proxy-forwarder] onUsage threw (non-streaming path)');
    }
  }

  // --------------------------------------------------------------------
  // Streaming path
  // --------------------------------------------------------------------

  private async pipeStreaming(
    upstream: Response,
    res: Response,
    opts: ForwardOptions,
  ): Promise<void> {
    // Upstream might fail with a non-2xx before any SSE bytes land. In
    // that case pass the body through as-is (Anthropic returns JSON).
    if (!upstream.ok || !upstream.body) {
      await this.pipeJson(upstream, res, opts);
      return;
    }

    res.status(upstream.status);
    res.set('content-type', 'text/event-stream; charset=utf-8');
    res.set('cache-control', 'no-cache, no-transform');
    res.set('connection', 'keep-alive');
    // Flush headers immediately so the client can start processing.
    if (typeof (res as any).flushHeaders === 'function') {
      (res as any).flushHeaders();
    }

    let inputTokens = 0;
    let outputTokens = 0;
    const decoder = new TextDecoder();
    let buffer = '';

    const onSseEvent = (payload: Record<string, unknown>) => {
      const type = payload.type;
      if (type === 'message_start') {
        const m = (payload as any).message;
        const u = m?.usage;
        if (u) {
          if (typeof u.input_tokens === 'number') {
            inputTokens = u.input_tokens;
          }
          if (typeof u.output_tokens === 'number') {
            outputTokens = u.output_tokens;
          }
        }
      } else if (type === 'message_delta') {
        const u = (payload as any).usage;
        if (u && typeof u.output_tokens === 'number') {
          // Anthropic reports cumulative output_tokens in message_delta.
          outputTokens = u.output_tokens;
        }
        if (u && typeof u.input_tokens === 'number') {
          inputTokens = u.input_tokens;
        }
      }
    };

    const reader = (upstream.body as ReadableStream<Uint8Array>).getReader();

    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        if (!value || value.length === 0) continue;
        // Write upstream bytes to the client immediately.
        if (!res.writableEnded) {
          res.write(Buffer.from(value));
        } else {
          // Client gave up — drop the rest on the floor.
          break;
        }
        // Parse for usage tracking without mutating the forwarded bytes.
        buffer += decoder.decode(value, { stream: true });
        buffer = parseSseEvents(buffer, onSseEvent);
      }
      // Flush any trailing buffered event.
      if (buffer.length > 0) {
        parseSseEvents(buffer + '\n\n', onSseEvent);
      }
    } catch (err) {
      if ((err as any)?.name !== 'AbortError') {
        logger.warn(
          { err },
          '[llm-proxy-forwarder] streaming read failed',
        );
      }
    } finally {
      try {
        if (!res.writableEnded) res.end();
      } catch {
        /* ignore */
      }
      try {
        opts.onUsage(inputTokens, outputTokens);
      } catch (err) {
        logger.warn({ err }, '[llm-proxy-forwarder] onUsage threw (streaming path)');
      }
    }
  }
}
