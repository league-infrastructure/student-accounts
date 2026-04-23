/**
 * Public LLM proxy routes (Sprint 013 T004).
 *
 * Mounted at /proxy/v1 (outside /api) so Anthropic-compatible clients can
 * set ANTHROPIC_BASE_URL="<origin>/proxy" and hit /v1/messages directly.
 *
 * Routes:
 *   GET  /proxy/v1/health    — unauthenticated liveness probe.
 *   POST /proxy/v1/messages  — bearer-authed forwarder to the Anthropic
 *                              Messages API.
 *
 * The forwarder handler:
 *   1. Requires a valid LlmProxyToken via the llmProxyTokenAuth middleware.
 *   2. Returns 503 up-front when the server has no Anthropic API key
 *      configured (so the token holder sees a clear error instead of a
 *      network-timeout).
 *   3. Delegates the forward to LlmProxyForwarderService, which preserves
 *      streaming and reports token usage via the onUsage callback.
 *   4. Updates LlmProxyToken counters via recordUsage (fire-and-forget —
 *      accounting drift is acceptable; see T002 rationale).
 */

import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { llmProxyTokenAuth } from '../middleware/llmProxyTokenAuth.js';
import type { LlmProxyToken } from '../generated/prisma/client.js';

export const llmProxyRouter = Router();

// ---------------------------------------------------------------------------
// GET /health — unauthenticated liveness probe
// ---------------------------------------------------------------------------

// Enable CORS for all /proxy routes — the LLM proxy is accessed from browser-based SDKs
// like Claude Code, which need to make cross-origin requests.
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

llmProxyRouter.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, endpoint: '/proxy/v1/messages' });
});

// ---------------------------------------------------------------------------
// POST /messages — bearer-authed forwarder
// ---------------------------------------------------------------------------
//
// Explicit express.json() with a generous limit — Claude requests carry
// base64 images and can be large. The rest of the app's /api routes are
// unaffected.
//
const jsonBody = express.json({ limit: '10mb' });

llmProxyRouter.post(
  '/messages',
  jsonBody,
  llmProxyTokenAuth,
  async (req: Request, res: Response) => {
    const forwarder = req.services.llmProxyForwarder;
    const tokens = req.services.llmProxyTokens;
    const row = (res.locals as { llmProxyToken?: LlmProxyToken }).llmProxyToken;

    if (!forwarder.isConfigured()) {
      res.status(503).json({
        error:
          'LLM proxy is not configured on the server (missing ANTHROPIC_API_KEY).',
      });
      return;
    }

    await forwarder.forwardMessages(req, res, {
      onUsage: (input, output) => {
        if (row) {
          // Fire-and-forget — errors are swallowed by recordUsage itself.
          void tokens.recordUsage(row.id, input, output);
        }
      },
    });
  },
);

// ---------------------------------------------------------------------------
// 405 for any other method on /messages
// ---------------------------------------------------------------------------

llmProxyRouter.all('/messages', (_req: Request, res: Response) => {
  res.set('allow', 'POST');
  res.status(405).json({ error: 'Method not allowed; use POST.' });
});
