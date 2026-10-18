/**
 * LlmProxyForwarderService — OpenRouter/OpenAI Chat Completions forwarder.
 *
 * Responsibilities:
 *  - Hold the server-side OpenRouter API key.
 *  - Forward POST /proxy/v1/messages → LLM_PROXY_BASE_URL (default:
 *    https://openrouter.ai/api/v1/chat/completions) using the OpenAI Chat
 *    Completions protocol, preserving streaming (SSE).
 *  - Report usage to the caller via an `onUsage(report)` callback after the
 *    request completes so the caller can update `LlmProxyToken` counters and
 *    write the request log. The report carries token counts, OpenRouter's
 *    USD cost (or null when it did not supply one — the token service then
 *    estimates it), the model requested / sent, and the upstream status.
 *
 * Security invariants:
 *  - The client-supplied Authorization header is stripped. The real API key
 *    never leaves the server.
 *  - The client-supplied x-api-key header is also stripped.
 *
 * Streaming:
 *  - Bytes are piped from the upstream ReadableStream to `res.write(chunk)`
 *    as they arrive — no buffering of the whole response.
 *  - When `body.stream === true`, `stream_options: { include_usage: true }`
 *    is injected into the forwarded body so OpenRouter returns token counts
 *    in the final SSE chunk.
 *  - SSE events are parsed in-flight to extract `usage.prompt_tokens`,
 *    `usage.completion_tokens` and `usage.cost` from the final chunk. These
 *    drive the `onUsage` callback after the stream finishes.
 *
 * Cost accounting (sprint 003):
 *  - `usage: { include: true }` is merged into every forwarded body (any
 *    client-supplied `usage` fields are preserved) so OpenRouter reports the
 *    request's cost in USD as `usage.cost` — in the JSON body for
 *    non-streaming calls, in the final usage-bearing chunk for streams.
 *  - Client disconnects (`res.once('close', …)`) abort the upstream fetch via
 *    AbortController so we stop consuming OpenRouter tokens when the client
 *    has gone.
 */

import type { Request, Response as ExpressResponse } from 'express';
import { AppError } from '../errors.js';
import { createLogger } from './logger.js';
import { DEFAULT_TIER_MODELS } from './llm-proxy-pricing.js';

const logger = createLogger('llm-proxy-forwarder');

// ---------------------------------------------------------------------------
// Constants — model tier defaults (shared with TierPricing so the fallback
// price table maps a sent slug back to the same tier; sprint 003)
// ---------------------------------------------------------------------------

const DEFAULT_MODEL_LARGE = DEFAULT_TIER_MODELS.large;
const DEFAULT_MODEL_MEDIUM = DEFAULT_TIER_MODELS.medium;
const DEFAULT_MODEL_SMALL = DEFAULT_TIER_MODELS.small;
const DEFAULT_BASE_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the server has no OpenRouter API key configured. The route
 * layer translates this to HTTP 503.
 */
export class LlmProxyNotConfiguredError extends AppError {
  constructor(
    message = 'LLM proxy is not configured: OPENROUTER_API_KEY (or LLM_PROXY_API_KEY) is missing.',
  ) {
    super(message, 503);
    this.name = 'LlmProxyNotConfiguredError';
  }
}

// ---------------------------------------------------------------------------
// Public option types
// ---------------------------------------------------------------------------

/**
 * What one forwarded call cost. Passed to `ForwardOptions.onUsage` exactly
 * once per call, including upstream errors (zero tokens, null cost, the
 * upstream status) and fetch failures (status 502).
 */
export type UsageReport = {
  inputTokens: number;
  outputTokens: number;
  /** OpenRouter's `usage.cost` in USD, or null when the response had none. */
  costUsd: number | null;
  /** The model string the client sent (e.g. "league-small"), or null. */
  modelRequested: string | null;
  /** The OpenRouter slug actually sent upstream after tier mapping. */
  modelSent: string;
  /** Wire protocol of the proxied call. This forwarder speaks OpenAI. */
  protocol: 'openai' | 'anthropic';
  /** HTTP status returned to the client (upstream's, or 502 on fetch failure). */
  status: number;
};

export type ForwardOptions = {
  /**
   * Called once after the upstream request (and, for streaming, after the
   * stream completes) with the usage extracted from the response. Callers
   * use this to update LlmProxyToken counters and the request log.
   */
  onUsage: (usage: UsageReport) => void;
};

/** Model identity captured before the fetch; every report carries it. */
type ModelContext = {
  modelRequested: string | null;
  modelSent: string;
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Resolve the API key from environment variables.
 *
 * Precedence: OPENROUTER_API_KEY ?? LLM_PROXY_API_KEY ?? ''
 *
 * Strips the placeholder shipped in secrets.env.example
 * ("your-anthropic-api-key"). No admin-key guard — not applicable to
 * OpenRouter keys.
 */
export function resolveLlmProxyApiKey(): string {
  const raw =
    process.env.OPENROUTER_API_KEY ??
    process.env.LLM_PROXY_API_KEY ??
    '';
  if (!raw) return '';
  if (raw === 'your-anthropic-api-key') return '';
  return raw;
}

/**
 * Map a client-provided model string to a League tier model on OpenRouter.
 *
 * Rules (case-insensitive full-string match):
 *  - 'league-large' | 'large' | 'opus'   → LLM_PROXY_MODEL_LARGE  (or default)
 *  - 'league-medium' | 'medium' | 'sonnet' → LLM_PROXY_MODEL_MEDIUM (or default)
 *  - 'league-small' | 'small' | 'haiku'  → LLM_PROXY_MODEL_SMALL  (or default)
 *  - Unknown / absent → MEDIUM (cost-control default)
 */
function mapModel(model: unknown): string {
  const large = process.env.LLM_PROXY_MODEL_LARGE ?? DEFAULT_MODEL_LARGE;
  const medium = process.env.LLM_PROXY_MODEL_MEDIUM ?? DEFAULT_MODEL_MEDIUM;
  const small = process.env.LLM_PROXY_MODEL_SMALL ?? DEFAULT_MODEL_SMALL;

  if (typeof model !== 'string') return medium;
  const lower = model.toLowerCase().trim();

  if (lower === 'league-large' || lower === 'large' || lower === 'opus') {
    return large;
  }
  if (lower === 'league-medium' || lower === 'medium' || lower === 'sonnet') {
    return medium;
  }
  if (lower === 'league-small' || lower === 'small' || lower === 'haiku') {
    return small;
  }

  // Unknown → MEDIUM (cost-control default)
  return medium;
}

/**
 * Parse SSE event bytes looking for `data: {...}` lines and invoke the
 * callback with the parsed JSON payload. Handles multi-line events.
 */
export function parseSseEvents(
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
      // Non-JSON data lines are ignored.
    }
  }
  return remainder;
}

/**
 * Read token counts and cost from an OpenAI/OpenRouter `usage` object.
 * Missing or non-numeric fields leave the defaults (0 tokens, null cost).
 */
function readUsage(usage: unknown): {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
} {
  const out = { inputTokens: 0, outputTokens: 0, costUsd: null as number | null };
  if (!usage || typeof usage !== 'object') return out;
  const u = usage as Record<string, unknown>;
  const input = Number(u.prompt_tokens ?? 0);
  const output = Number(u.completion_tokens ?? 0);
  out.inputTokens = Number.isFinite(input) ? input : 0;
  out.outputTokens = Number.isFinite(output) ? output : 0;
  if (typeof u.cost === 'number' && Number.isFinite(u.cost)) {
    out.costUsd = u.cost;
  }
  return out;
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
   * Forward the given request to OpenRouter (via OpenAI Chat Completions
   * protocol) and write the response into the caller's Express response.
   * Preserves streaming.
   */
  async forwardMessages(
    req: Request,
    res: ExpressResponse,
    opts: ForwardOptions,
  ): Promise<void> {
    if (!this.apiKey) {
      throw new LlmProxyNotConfiguredError();
    }

    const body = req.body ?? {};
    const isObjectBody = body && typeof body === 'object';
    const isStream = isObjectBody && body.stream === true;

    // Remember what the client asked for, then map the model to an allowed
    // League tier. Defaults to MEDIUM.
    const requested = isObjectBody ? (body as any).model : undefined;
    const modelRequested = typeof requested === 'string' ? requested : null;
    const modelSent = mapModel(requested);
    if (isObjectBody) {
      (body as any).model = modelSent;
    }
    const model: ModelContext = { modelRequested, modelSent };

    // Inject stream_options so OpenRouter includes usage in the final chunk.
    if (isStream) {
      (body as any).stream_options = { include_usage: true };
    }

    // Ask OpenRouter to report the request's cost (`usage.cost`, USD).
    // Preserve any other `usage` fields the client set.
    if (isObjectBody) {
      const clientUsage = (body as any).usage;
      (body as any).usage = {
        ...(clientUsage && typeof clientUsage === 'object' && !Array.isArray(clientUsage)
          ? clientUsage
          : {}),
        include: true,
      };
    }

    // Build upstream headers. Strip any client-supplied auth.
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': `Bearer ${this.apiKey}`,
    };

    // Optional OpenRouter attribution headers.
    const httpReferer = process.env.LLM_PROXY_HTTP_REFERER;
    if (httpReferer) headers['HTTP-Referer'] = httpReferer;
    const xTitle = process.env.LLM_PROXY_X_TITLE;
    if (xTitle) headers['X-Title'] = xTitle;

    const upstreamUrl =
      process.env.LLM_PROXY_BASE_URL ?? DEFAULT_BASE_URL;

    logger.info(
      {
        isStream,
        model: (body as any)?.model ?? null,
        hasMessages: Array.isArray((body as any)?.messages),
        upstreamUrl,
      },
      '[llm-proxy-forwarder] forwarding request to openrouter',
    );

    const controller = new AbortController();
    // If the client hangs up, abort the upstream so we stop consuming
    // OpenRouter tokens.
    const abortOnClose = () => {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    };
    res.once('close', abortOnClose);

    let upstream: Response;
    try {
      upstream = (await fetch(upstreamUrl, {
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
          error: 'Upstream OpenRouter request failed',
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
        opts.onUsage({
          inputTokens: 0,
          outputTokens: 0,
          costUsd: null,
          ...model,
          protocol: 'openai',
          status: 502,
        });
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      if (isStream) {
        await this.pipeStreaming(upstream, res, opts, model);
      } else {
        await this.pipeJson(upstream, res, opts, model);
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
    res: ExpressResponse,
    opts: ForwardOptions,
    model: ModelContext,
  ): Promise<void> {
    const text = await upstream.text();
    const status = upstream.status;

    if (status >= 400) {
      logger.warn(
        { status, body: text.slice(0, 1000) },
        '[llm-proxy-forwarder] upstream returned non-2xx — forwarding to client',
      );
    }

    res.status(status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    res.send(text);

    // OpenAI Chat Completions format: usage.prompt_tokens /
    // usage.completion_tokens, plus OpenRouter's usage.cost (USD) when the
    // request asked for it. Error bodies normally carry no usage, so they
    // report zero tokens and a null cost with the upstream status.
    let usage = readUsage(null);
    try {
      const parsed = JSON.parse(text) as any;
      usage = readUsage(parsed?.usage);
    } catch {
      // Non-JSON body — report zero tokens.
    }
    try {
      opts.onUsage({ ...usage, ...model, protocol: 'openai', status });
    } catch (err) {
      logger.warn({ err }, '[llm-proxy-forwarder] onUsage threw (non-streaming path)');
    }
  }

  // --------------------------------------------------------------------
  // Streaming path
  // --------------------------------------------------------------------

  private async pipeStreaming(
    upstream: Response,
    res: ExpressResponse,
    opts: ForwardOptions,
    model: ModelContext,
  ): Promise<void> {
    // Upstream might fail with a non-2xx before any SSE bytes land. In
    // that case pass the body through as-is (OpenRouter returns JSON).
    if (!upstream.ok || !upstream.body) {
      await this.pipeJson(upstream, res, opts, model);
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
    let costUsd: number | null = null;
    const decoder = new TextDecoder();
    let buffer = '';

    // OpenAI SSE: usage appears in the final chunk when
    // stream_options.include_usage is true; OpenRouter puts `cost` (USD) in
    // that same chunk when the body asked for `usage: { include: true }`.
    const onSseEvent = (payload: Record<string, unknown>) => {
      const usage = (payload as any).usage;
      if (usage && typeof usage === 'object') {
        if (typeof usage.prompt_tokens === 'number') {
          inputTokens = usage.prompt_tokens;
        }
        if (typeof usage.completion_tokens === 'number') {
          outputTokens = usage.completion_tokens;
        }
        if (typeof usage.cost === 'number' && Number.isFinite(usage.cost)) {
          costUsd = usage.cost;
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
        opts.onUsage({
          inputTokens,
          outputTokens,
          costUsd,
          ...model,
          protocol: 'openai',
          status: upstream.status,
        });
      } catch (err) {
        logger.warn({ err }, '[llm-proxy-forwarder] onUsage threw (streaming path)');
      }
    }
  }
}
