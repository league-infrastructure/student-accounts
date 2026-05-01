/**
 * account-apps.ts — Sprint 016.
 *
 * GET /apps — returns the authenticated user's application tile list.
 * Mounted under /api/account in app.ts, so the full path is
 * GET /api/account/apps.
 *
 * Auth: requireAuth only (no requireRole — all roles can call this).
 */

import { Router, Request, Response } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import { computeAppTiles } from '../services/app-tiles.service.js';

export const accountAppsRouter = Router();

accountAppsRouter.get(
  '/account/apps',
  requireAuth,
  async (req: Request, res: Response) => {
    const userId: number = (req.session as any).userId;
    const role: string = (req.session as any).role ?? 'student';

    // Normalise role to the union accepted by computeAppTiles.
    const normalisedRole = (role === 'admin' || role === 'staff' || role === 'student')
      ? (role as 'admin' | 'staff' | 'student')
      : 'student';

    // Look up whether the user has an active LLM proxy token.
    const activeToken = await req.services.llmProxyTokens.getActiveForUser(userId);
    const llmProxyEnabled = activeToken != null;

    const tiles = computeAppTiles({ role: normalisedRole, llmProxyEnabled });

    res.json({ tiles });
  },
);
