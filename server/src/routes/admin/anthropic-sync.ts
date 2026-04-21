/**
 * Admin routes for Anthropic (Claude) sync and probe (Sprint 010 T012).
 *
 * POST /sync/claude
 *   Runs AnthropicSyncService.reconcile() and returns SyncReport as JSON.
 *   Returns 503 if the Anthropic API is unreachable.
 *
 * GET /anthropic/probe
 *   Calls the probe helper to check Anthropic Admin API connectivity.
 *   Returns ProbeResult:
 *     { ok, org, userCount, workspaces, invitesCount, writeEnabled, error? }
 *
 * Auth (requireAuth + requireRole('admin')) is applied by the parent adminRouter
 * in routes/admin/index.ts — individual handlers do not re-apply those guards.
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AnthropicAdminApiError } from '../../services/anthropic/anthropic-admin.client.js';
import { probeAnthropicAdmin } from '../../services/anthropic/probe.js';

export const anthropicSyncRouter = Router();

// ---------------------------------------------------------------------------
// POST /sync/claude
// ---------------------------------------------------------------------------

/**
 * POST /sync/claude
 *
 * Triggers a full Anthropic org reconcile and returns the SyncReport.
 * Auth is handled by the parent router middleware.
 *
 * Returns 503 when the Anthropic Admin API is unreachable (network error or
 * non-2xx HTTP status from the upstream API).
 */
anthropicSyncRouter.post(
  '/sync/claude',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const actorId = (req.session as any).userId as number | undefined;
      const report = await req.services.anthropicSync.reconcile(actorId ?? null);
      res.status(200).json(report);
    } catch (err) {
      if (err instanceof AnthropicAdminApiError) {
        res.status(503).json({ error: (err as Error).message });
        return;
      }
      next(err);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /anthropic/probe
// ---------------------------------------------------------------------------

/**
 * GET /anthropic/probe
 *
 * Calls the Anthropic Admin API probe helper and returns a structured status
 * object. Always returns 200 — connectivity failures are surfaced in the
 * response body via the `ok` flag and optional `error` string.
 *
 * Response shape:
 *   {
 *     ok: boolean,
 *     org: { id: string, name: string } | null,
 *     userCount: number | null,
 *     workspaces: string[],
 *     invitesCount: number | null,
 *     writeEnabled: boolean,
 *     error?: string
 *   }
 */
anthropicSyncRouter.get(
  '/anthropic/probe',
  async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      const result = await probeAnthropicAdmin(req.services.anthropicAdmin);
      res.status(200).json(result);
    } catch (err) {
      next(err);
    }
  },
);
