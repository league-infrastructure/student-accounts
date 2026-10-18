/**
 * Public LLM proxy routes.
 *
 * Mounted at /proxy/v1 (outside /api) so OpenAI-compatible clients can set
 * OPENAI_BASE_URL="<origin>/proxy/v1" and hit /chat/completions directly, and
 * Anthropic clients (Claude Code) can set ANTHROPIC_BASE_URL="<origin>/proxy"
 * and hit /v1/messages.
 *
 * Routes:
 *   GET  /proxy/v1/health                — unauthenticated liveness probe.
 *   GET  /proxy/v1/models                — unauthenticated League model tier list.
 *   POST /proxy/v1/chat/completions      — token-authed OpenAI-protocol forwarder
 *                                          to the upstream LLM API (OpenRouter).
 *   POST /proxy/v1/messages              — token-authed Anthropic-protocol
 *                                          forwarder to OpenRouter's Anthropic-
 *                                          compatible endpoint (sprint 003).
 *                                          404 when LLM_PROXY_ANTHROPIC_ENABLED
 *                                          is not 'true'.
 *   POST /proxy/v1/messages/count_tokens — 404 JSON: OpenRouter has no token
 *                                          counting endpoint (verified
 *                                          2026-10-18); Claude Code tolerates
 *                                          the 404 and falls back to estimates.
 *
 * Both forwarder handlers:
 *   1. Require a valid LlmProxyToken via the llmProxyTokenAuth middleware
 *      (`Authorization: Bearer llmp_…` or `x-api-key: llmp_…`).
 *   2. Return 503 up-front when the server has no API key configured (so
 *      the token holder sees a clear error instead of a network-timeout).
 *   3. Delegate the forward to LlmProxyForwarderService, which preserves
 *      streaming and reports usage (tokens, OpenRouter cost, model, protocol,
 *      status) via the onUsage callback.
 *   4. Hand that report to recordUsage, which updates the LlmProxyToken
 *      counters and dollar totals and writes one LlmProxyRequest row
 *      (fire-and-forget — accounting drift is acceptable; see T002
 *      rationale).
 */

import express, { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { llmProxyTokenAuth } from '../middleware/llmProxyTokenAuth.js';
import { getConfig } from '../services/config.js';
import type { LlmProxyToken } from '../generated/prisma/client.js';
import type { ForwardOptions } from '../services/llm-proxy-forwarder.service.js';

export const llmProxyRouter = Router();

/** Is the Anthropic-compatible surface switched on? Read per request (config is live). */
export function anthropicProxyEnabled(): boolean {
  return getConfig('LLM_PROXY_ANTHROPIC_ENABLED') === 'true';
}

// ---------------------------------------------------------------------------
// CORS for all /proxy routes — the LLM proxy is accessed from browser-based
// SDKs, which need to make cross-origin requests. The Anthropic SDK sends
// x-api-key / anthropic-version / anthropic-beta.
// ---------------------------------------------------------------------------

llmProxyRouter.use((_req: Request, res: Response, next) => {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.header(
    'Access-Control-Allow-Headers',
    'Content-Type, Authorization, anthropic-version, anthropic-beta, x-api-key',
  );
  if (_req.method === 'OPTIONS') {
    res.sendStatus(204);
  } else {
    next();
  }
});

// ---------------------------------------------------------------------------
// GET /health — unauthenticated liveness probe
// ---------------------------------------------------------------------------

llmProxyRouter.get('/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    endpoint: '/proxy/v1/chat/completions',
    ...(anthropicProxyEnabled() ? { anthropicEndpoint: '/proxy/v1/messages' } : {}),
  });
});

// ---------------------------------------------------------------------------
// GET /models — unauthenticated League model tier list
// ---------------------------------------------------------------------------

llmProxyRouter.get('/models', (_req: Request, res: Response) => {
  res.json({
    object: 'list',
    data: [
      { id: 'league-large', object: 'model', owned_by: 'league' },
      { id: 'league-medium', object: 'model', owned_by: 'league' },
      { id: 'league-small', object: 'model', owned_by: 'league' },
    ],
  });
});

// ---------------------------------------------------------------------------
// Shared forwarder handler plumbing
// ---------------------------------------------------------------------------
//
// Explicit express.json() with a generous limit — requests carrying
// base64 images can be large. The rest of the app's /api routes are
// unaffected.
//
const jsonBody = express.json({ limit: '10mb' });

/**
 * Build the usage callback that records the forwarder's report against the
 * authenticated token (set on res.locals by llmProxyTokenAuth).
 */
function usageRecorder(req: Request, res: Response): ForwardOptions {
  const tokens = req.services.llmProxyTokens;
  const row = (res.locals as { llmProxyToken?: LlmProxyToken }).llmProxyToken;
  return {
    onUsage: (report) => {
      if (row) {
        // Fire-and-forget — errors are swallowed by recordUsage itself.
        void tokens.recordUsage(row.id, report);
      }
    },
  };
}

/** 503 when the server has no upstream API key; otherwise continue. */
function requireConfigured(req: Request, res: Response, next: NextFunction): void {
  if (!req.services.llmProxyForwarder.isConfigured()) {
    res.status(503).json({
      error: 'LLM proxy is not configured on the server (missing OPENROUTER_API_KEY).',
    });
    return;
  }
  next();
}

/** 404 when the Anthropic surface is switched off; otherwise continue. */
function requireAnthropicEnabled(_req: Request, res: Response, next: NextFunction): void {
  if (!anthropicProxyEnabled()) {
    res.status(404).json({ error: 'anthropic endpoint disabled' });
    return;
  }
  next();
}

// ---------------------------------------------------------------------------
// POST /chat/completions — OpenAI protocol
// ---------------------------------------------------------------------------

llmProxyRouter.post(
  '/chat/completions',
  jsonBody,
  llmProxyTokenAuth,
  requireConfigured,
  async (req: Request, res: Response) => {
    await req.services.llmProxyForwarder.forwardMessages(req, res, usageRecorder(req, res));
  },
);

// 405 for any other method on /chat/completions
llmProxyRouter.all('/chat/completions', (_req: Request, res: Response) => {
  res.set('allow', 'POST');
  res.status(405).json({ error: 'Method not allowed; use POST.' });
});

// ---------------------------------------------------------------------------
// POST /messages — Anthropic protocol (sprint 003)
// ---------------------------------------------------------------------------
//
// The flag check runs before auth so a disabled surface looks absent to
// every caller, token or not.

llmProxyRouter.post(
  '/messages',
  requireAnthropicEnabled,
  jsonBody,
  llmProxyTokenAuth,
  requireConfigured,
  async (req: Request, res: Response) => {
    await req.services.llmProxyForwarder.forwardAnthropicMessages(
      req,
      res,
      usageRecorder(req, res),
    );
  },
);

// 405 for any other method on /messages (404 while disabled)
llmProxyRouter.all('/messages', requireAnthropicEnabled, (_req: Request, res: Response) => {
  res.set('allow', 'POST');
  res.status(405).json({ error: 'Method not allowed; use POST.' });
});

// Token counting: OpenRouter's Anthropic-compatible surface has no
// /v1/messages/count_tokens (it answers 404), so there is nothing to pass
// through. Answer 404 locally with a message that says so. Claude Code treats
// the 404 as "unsupported" and estimates locally.
llmProxyRouter.all('/messages/count_tokens', (_req: Request, res: Response) => {
  res.status(404).json({
    error:
      'Token counting is not supported by the League LLM proxy: the upstream ' +
      '(OpenRouter) has no /v1/messages/count_tokens endpoint. Clients should ' +
      'fall back to a local estimate.',
  });
});
