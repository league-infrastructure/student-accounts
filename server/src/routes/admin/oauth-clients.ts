/**
 * Admin CRUD routes for OAuth clients — /api/admin/oauth-clients (Sprint 018).
 *
 * All routes are guarded by requireRole('admin') (enforced at the admin router
 * level in routes/admin/index.ts — no need to repeat here, but actor extraction
 * still uses req.session.userId).
 *
 * Endpoints:
 *  GET    /oauth-clients                — list clients (no secrets)
 *  POST   /oauth-clients                — create (returns client + plaintext secret ONCE)
 *  PATCH  /oauth-clients/:id            — update name/description/redirect_uris/allowed_scopes
 *  POST   /oauth-clients/:id/rotate-secret — rotate secret (returns plaintext ONCE)
 *  DELETE /oauth-clients/:id            — soft-delete (sets disabled_at); returns 204
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { AppError } from '../../errors.js';

export const adminOAuthClientsRouter = Router();

// ---------------------------------------------------------------------------
// GET /oauth-clients — list all clients (no secrets)
// ---------------------------------------------------------------------------

adminOAuthClientsRouter.get('/oauth-clients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clients = await req.services.oauthClients.list();
    res.json(clients);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /oauth-clients — create (plaintext secret returned once)
// ---------------------------------------------------------------------------

adminOAuthClientsRouter.post('/oauth-clients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actorId = (req.session as any).userId as number;
    const { name, description, redirect_uris, allowed_scopes } = req.body as Record<string, unknown>;

    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'name is required' });
    }
    if (!Array.isArray(redirect_uris) || redirect_uris.some((s) => typeof s !== 'string')) {
      return res.status(400).json({ error: 'redirect_uris must be an array of strings' });
    }
    if (!Array.isArray(allowed_scopes) || allowed_scopes.some((s) => typeof s !== 'string')) {
      return res.status(400).json({ error: 'allowed_scopes must be an array of strings' });
    }

    const { client, plaintextSecret } = await req.services.oauthClients.create(
      {
        name: name as string,
        description: typeof description === 'string' ? description : undefined,
        redirect_uris: redirect_uris as string[],
        allowed_scopes: allowed_scopes as string[],
      },
      actorId,
    );

    // Return the client AND the plaintext secret (shown once, never again).
    res.status(201).json({ client, client_secret: plaintextSecret });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /oauth-clients/:id — update name/description/redirect_uris/allowed_scopes
// ---------------------------------------------------------------------------

adminOAuthClientsRouter.patch('/oauth-clients/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const actorId = (req.session as any).userId as number;
    const body = req.body as Record<string, unknown>;
    const patch: Record<string, unknown> = {};

    if ('name' in body) {
      if (typeof body.name !== 'string') return res.status(400).json({ error: 'name must be a string' });
      patch.name = body.name;
    }
    if ('description' in body) {
      if (body.description !== null && typeof body.description !== 'string') {
        return res.status(400).json({ error: 'description must be a string or null' });
      }
      patch.description = body.description as string | null;
    }
    if ('redirect_uris' in body) {
      if (!Array.isArray(body.redirect_uris) || (body.redirect_uris as unknown[]).some((s) => typeof s !== 'string')) {
        return res.status(400).json({ error: 'redirect_uris must be an array of strings' });
      }
      patch.redirect_uris = body.redirect_uris as string[];
    }
    if ('allowed_scopes' in body) {
      if (!Array.isArray(body.allowed_scopes) || (body.allowed_scopes as unknown[]).some((s) => typeof s !== 'string')) {
        return res.status(400).json({ error: 'allowed_scopes must be an array of strings' });
      }
      patch.allowed_scopes = body.allowed_scopes as string[];
    }

    const client = await req.services.oauthClients.update(id, patch as any, actorId);
    res.json(client);
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'OAuth client not found' });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /oauth-clients/:id/rotate-secret — rotate secret (plaintext returned once)
// ---------------------------------------------------------------------------

adminOAuthClientsRouter.post('/oauth-clients/:id/rotate-secret', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const actorId = (req.session as any).userId as number;
    const { plaintextSecret } = await req.services.oauthClients.rotateSecret(id, actorId);
    res.json({ client_secret: plaintextSecret });
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'OAuth client not found' });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /oauth-clients/:id — soft delete (sets disabled_at); returns 204
// ---------------------------------------------------------------------------

adminOAuthClientsRouter.delete('/oauth-clients/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const actorId = (req.session as any).userId as number;
    await req.services.oauthClients.disable(id, actorId);
    res.status(204).send();
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'OAuth client not found' });
    next(err);
  }
});
