/**
 * LlmProxyForwarderService — OpenRouter passthrough in two wire protocols.
 *
 * Responsibilities:
 *  - Hold the server-side OpenRouter API key.
 *  - `forwardMessages`: POST /proxy/v1/chat/completions → LLM_PROXY_BASE_URL
 *    (default https://openrouter.ai/api/v1/chat/completions), OpenAI Chat
 *    Completions protocol.
 *  - `forwardAnthropicMessages` (sprint 003): POST /proxy/v1/messages →
 *    LLM_PROXY_ANTHROPIC_BASE_URL (default https://openrouter.ai/api/v1/messages),
 *    OpenRouter's Anthropic-compatible Messages endpoint, so Claude Code can
 *    point ANTHROPIC_BASE_URL at the proxy. Request and response bodies pass
 *    through untranslated; only `model` is rewritten to a League tier slug.
 *  - Both report usage to the caller via one `onUsage(report)` callback after
 *    the request completes so the caller can update `LlmProxyToken` counters
 *    and write the request log. The report carries token counts, OpenRouter's
 *    USD cost (or null when it did not supply one — the token service then
 *    estimates it), the model requested / sent, the protocol and the status.
 *
 * Security invariants:
 *  - The client-supplied Authorization header is stripped. The real API key
 *    never leaves the server.
 *  - The client-supplied x-api-key header is also stripped.
 *  - On the Anthropic path `anthropic-version` and `anthropic-beta` are
 *    passed through (newer Claude Code builds rely on the beta header).
 *
 * Streaming (both protocols):
 *  - Bytes are piped from the upstream ReadableStream to `res.write(chunk)`
 *    as they arrive — no buffering of the whole response.
 *  - SSE events are parsed in-flight for usage without touching the bytes.
 *    OpenAI: `usage.prompt_tokens` / `usage.completion_tokens` / `usage.cost`
 *    from the final chunk (`stream_options.include_usage` is injected).
 *    Anthropic: `message.usage.input_tokens` from `message_start`, then the
 *    cumulative `usage.output_tokens` (and `usage.cost` when OpenRouter adds
 *    it) from the last `message_delta`.
 *  - Client disconnects (`res.once('close', …)`) abort the upstream fetch via
 *    AbortController so we stop consuming OpenRouter tokens when the client
 *    has gone.
 *
 * Cost accounting (sprint 003):
 *  - OpenAI path: `usage: { include: true }` is merged into every forwarded
 *    body (any client-supplied `usage` fields are preserved) so OpenRouter
 *    reports the request's cost in USD as `usage.cost`.
 *  - Anthropic path: the body is forwarded unchanged (the Anthropic request
 *    schema has no `usage` parameter); `usage.cost` is read when present and
 *    otherwise reported as null so TierPricing estimates it.
 */

import type { Request, Response as ExpressResponse } from 'express';
import { AppError } from '../errors.js';
import { createLogger } from './logger.js';
import { getConfig } from './config.js';
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
const DEFAULT_ANTHROPIC_BASE_URL = 'https://openrouter.ai/api/v1/messages';
/** Sent when the client omits `anthropic-version`; the protocol requires one. */
const DEFAULT_ANTHROPIC_VERSION = '2023-06-01';

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

/** Wire protocol of a proxied call. */
export type LlmProxyProtocol = 'openai' | 'anthropic';

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
  /** Wire protocol of the proxied call. */
  protocol: LlmProxyProtocol;
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

/** Token counts and cost pulled out of one response. */
type UsageCounts = {
  inputTokens: number;
  outputTokens: number;
  costUsd: number | null;
};

/** Accumulates usage across the SSE events of one streamed response. */
type SseUsageCollector = {
  onEvent(payload: Record<string, unknown>): void;
  result(): UsageCounts;
};

/** The protocol-specific half of usage extraction. */
type UsageParser = {
  /** Non-streaming: read usage from the parsed JSON body (any shape). */
  fromJson(parsed: unknown): UsageCounts;
  /** Streaming: a fresh collector fed every `data:` payload in order. */
  sseCollector(): SseUsageCollector;
};

/** Everything the shared forward loop needs for one upstream call. */
type UpstreamPlan = {
  protocol: LlmProxyProtocol;
  upstreamUrl: string;
  headers: Record<string, string>;
  body: unknown;
  isStream: boolean;
  model: ModelContext;
  usage: UsageParser;
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
 * Rules (case-insensitive, checked in order):
 *  - Exact: 'league-large' | 'large'   → LLM_PROXY_MODEL_LARGE  (or default)
 *           'league-medium' | 'medium' → LLM_PROXY_MODEL_MEDIUM (or default)
 *           'league-small' | 'small'   → LLM_PROXY_MODEL_SMALL  (or default)
 *  - Substring (sprint 003, so Claude Code's `claude-opus-4-…`,
 *    `claude-sonnet-4-5-…`, `claude-haiku-…` resolve without a lookup table):
 *           contains 'opus'   → LARGE
 *           contains 'sonnet' → MEDIUM
 *           contains 'haiku'  → SMALL
 *  - Unknown / absent → MEDIUM (cost-control default)
 */
export function mapModel(model: unknown): string {
  const large = process.env.LLM_PROXY_MODEL_LARGE ?? DEFAULT_MODEL_LARGE;
  const medium = process.env.LLM_PROXY_MODEL_MEDIUM ?? DEFAULT_MODEL_MEDIUM;
  const small = process.env.LLM_PROXY_MODEL_SMALL ?? DEFAULT_MODEL_SMALL;

  if (typeof model !== 'string') return medium;
  const lower = model.toLowerCase().trim();

  if (lower === 'league-large' || lower === 'large') return large;
  if (lower === 'league-medium' || lower === 'medium') return medium;
  if (lower === 'league-small' || lower === 'small') return small;

  if (lower.includes('opus')) return large;
  if (lower.includes('sonnet')) return medium;
  if (lower.includes('haiku')) return small;

  // Unknown → MEDIUM (cost-control default)
  return medium;
}

/**
 * Parse SSE event bytes looking for `data: {...}` lines and invoke the
 * callback with the parsed JSON payload. Handles multi-line events and
 * ignores `event:` / comment lines (Anthropic names every event).
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

/** A finite number, else null. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/** Read `usage[inputKey]` / `usage[outputKey]` / `usage.cost` from any object. */
function readUsageFields(
  usage: unknown,
  inputKey: string,
  outputKey: string,
): UsageCounts {
  const out: UsageCounts = { inputTokens: 0, outputTokens: 0, costUsd: null };
  if (!usage || typeof usage !== 'object') return out;
  const u = usage as Record<string, unknown>;
  const input = Number(u[inputKey] ?? 0);
  const output = Number(u[outputKey] ?? 0);
  out.inputTokens = Number.isFinite(input) ? input : 0;
  out.outputTokens = Number.isFinite(output) ? output : 0;
  out.costUsd = finiteOrNull(u.cost);
  return out;
}

/**
 * OpenAI Chat Completions usage: `usage.prompt_tokens` /
 * `usage.completion_tokens`, plus OpenRouter's `usage.cost`. Streaming puts
 * the whole object in the final chunk (with `stream_options.include_usage`).
 */
const openaiUsage: UsageParser = {
  fromJson(parsed) {
    return readUsageFields((parsed as any)?.usage, 'prompt_tokens', 'completion_tokens');
  },
  sseCollector() {
    const totals: UsageCounts = { inputTokens: 0, outputTokens: 0, costUsd: null };
    return {
      onEvent(payload) {
        const usage = (payload as any).usage;
        if (!usage || typeof usage !== 'object') return;
        if (typeof usage.prompt_tokens === 'number') totals.inputTokens = usage.prompt_tokens;
        if (typeof usage.completion_tokens === 'number') totals.outputTokens = usage.completion_tokens;
        const cost = finiteOrNull(usage.cost);
        if (cost !== null) totals.costUsd = cost;
      },
      result: () => ({ ...totals }),
    };
  },
};

/**
 * Anthropic Messages usage: `usage.input_tokens` / `usage.output_tokens`.
 * Streaming: `message_start` carries `message.usage` (input, and a small
 * initial output count); each `message_delta` carries the cumulative
 * `usage.output_tokens`, so the last one wins. `usage.cost` is read from
 * either event when OpenRouter includes it.
 */
const anthropicUsage: UsageParser = {
  fromJson(parsed) {
    return readUsageFields((parsed as any)?.usage, 'input_tokens', 'output_tokens');
  },
  sseCollector() {
    const totals: UsageCounts = { inputTokens: 0, outputTokens: 0, costUsd: null };
    const absorb = (usage: unknown) => {
      if (!usage || typeof usage !== 'object') return;
      const u = usage as Record<string, unknown>;
      if (typeof u.input_tokens === 'number') totals.inputTokens = u.input_tokens;
      if (typeof u.output_tokens === 'number') totals.outputTokens = u.output_tokens;
      const cost = finiteOrNull(u.cost);
      if (cost !== null) totals.costUsd = cost;
    };
    return {
      onEvent(payload) {
        if (payload.type === 'message_start') {
          absorb((payload as any).message?.usage);
        } else if (payload.type === 'message_delta') {
          absorb((payload as any).usage);
        }
      },
      result: () => ({ ...totals }),
    };
  },
};

/** Optional OpenRouter attribution headers, shared by both protocols. */
function attributionHeaders(): Record<string, string> {
  const headers: Record<string, string> = {};
  const httpReferer = process.env.LLM_PROXY_HTTP_REFERER;
  if (httpReferer) headers['HTTP-Referer'] = httpReferer;
  const xTitle = process.env.LLM_PROXY_X_TITLE;
  if (xTitle) headers['X-Title'] = xTitle;
  return headers;
}

/** Remember what the client asked for, then rewrite `model` to the tier slug. */
function applyModelMapping(body: unknown): ModelContext {
  const isObjectBody = !!body && typeof body === 'object';
  const requested = isObjectBody ? (body as any).model : undefined;
  const modelRequested = typeof requested === 'string' ? requested : null;
  const modelSent = mapModel(requested);
  if (isObjectBody) {
    (body as any).model = modelSent;
  }
  return { modelRequested, modelSent };
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

    // Map the model to an allowed League tier. Defaults to MEDIUM.
    const model = applyModelMapping(body);

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
      ...attributionHeaders(),
    };

    await this.forward(res, opts, {
      protocol: 'openai',
      upstreamUrl: process.env.LLM_PROXY_BASE_URL ?? DEFAULT_BASE_URL,
      headers,
      body,
      isStream,
      model,
      usage: openaiUsage,
    });
  }

  /**
   * Forward an Anthropic Messages request to OpenRouter's Anthropic-compatible
   * endpoint and write the response into the caller's Express response.
   * Preserves streaming. The body is forwarded unchanged apart from `model`
   * (sprint 003 — Claude Code support).
   */
  async forwardAnthropicMessages(
    req: Request,
    res: ExpressResponse,
    opts: ForwardOptions,
  ): Promise<void> {
    if (!this.apiKey) {
      throw new LlmProxyNotConfiguredError();
    }

    const body = req.body ?? {};
    const isStream = !!body && typeof body === 'object' && body.stream === true;

    const model = applyModelMapping(body);

    // Build upstream headers. Strip any client-supplied auth; carry the
    // protocol headers across. Prefer the client's version header — SDK
    // versions get bumped as new models ship, and forcing our pinned default
    // can downshift a request out of the model's required version.
    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'authorization': `Bearer ${this.apiKey}`,
      'anthropic-version': req.header('anthropic-version') ?? DEFAULT_ANTHROPIC_VERSION,
      ...attributionHeaders(),
    };
    const beta = req.header('anthropic-beta');
    if (beta) headers['anthropic-beta'] = beta;

    // Carry the client's query string across (e.g. `?beta=true` from some
    // Anthropic SDK versions) — passthrough, not translation.
    const originalUrl = req.originalUrl ?? '';
    const qsIndex = originalUrl.indexOf('?');
    const queryString = qsIndex >= 0 ? originalUrl.slice(qsIndex) : '';
    const configured = getConfig('LLM_PROXY_ANTHROPIC_BASE_URL');
    const baseUrl =
      configured && configured.trim() !== '' ? configured.trim() : DEFAULT_ANTHROPIC_BASE_URL;

    await this.forward(res, opts, {
      protocol: 'anthropic',
      upstreamUrl: `${baseUrl}${queryString}`,
      headers,
      body,
      isStream,
      model,
      usage: anthropicUsage,
    });
  }

  // --------------------------------------------------------------------
  // Shared fetch / stream / abort plumbing
  // --------------------------------------------------------------------

  private async forward(
    res: ExpressResponse,
    opts: ForwardOptions,
    plan: UpstreamPlan,
  ): Promise<void> {
    const { body, isStream, model, protocol, upstreamUrl } = plan;

    logger.info(
      {
        protocol,
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
        headers: plan.headers,
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
      logger.warn({ err, protocol }, '[llm-proxy-forwarder] upstream fetch failed');
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
          protocol,
          status: 502,
        });
      } catch {
        /* ignore */
      }
      return;
    }

    try {
      if (isStream) {
        await this.pipeStreaming(upstream, res, opts, plan);
      } else {
        await this.pipeJson(upstream, res, opts, plan);
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
    plan: UpstreamPlan,
  ): Promise<void> {
    const text = await upstream.text();
    const status = upstream.status;

    if (status >= 400) {
      logger.warn(
        { status, protocol: plan.protocol, body: text.slice(0, 1000) },
        '[llm-proxy-forwarder] upstream returned non-2xx — forwarding to client',
      );
    }

    res.status(status);
    const ct = upstream.headers.get('content-type');
    if (ct) res.set('content-type', ct);
    res.send(text);

    // Error bodies normally carry no usage, so they report zero tokens and
    // a null cost with the upstream status.
    let usage = plan.usage.fromJson(null);
    try {
      usage = plan.usage.fromJson(JSON.parse(text));
    } catch {
      // Non-JSON body — report zero tokens.
    }
    try {
      opts.onUsage({ ...usage, ...plan.model, protocol: plan.protocol, status });
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
    plan: UpstreamPlan,
  ): Promise<void> {
    // Upstream might fail with a non-2xx before any SSE bytes land. In
    // that case pass the body through as-is (OpenRouter returns JSON).
    if (!upstream.ok || !upstream.body) {
      await this.pipeJson(upstream, res, opts, plan);
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

    const collector = plan.usage.sseCollector();
    const decoder = new TextDecoder();
    let buffer = '';

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
        buffer = parseSseEvents(buffer, collector.onEvent);
      }
      // Flush any trailing buffered event.
      if (buffer.length > 0) {
        parseSseEvents(buffer + '\n\n', collector.onEvent);
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
          ...collector.result(),
          ...plan.model,
          protocol: plan.protocol,
          status: upstream.status,
        });
      } catch (err) {
        logger.warn({ err }, '[llm-proxy-forwarder] onUsage threw (streaming path)');
      }
    }
  }
}
