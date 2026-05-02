/**
 * OAuth Clients CRUD routes — /api/oauth-clients (Sprint 020).
 *
 * Promoted out of /admin in Sprint 020. All authenticated users can register
 * and manage their own OAuth clients. Admins see and can mutate all clients.
 *
 * Endpoints:
 *  GET    /oauth-clients                — list clients (filtered by ownership for non-admins)
 *  POST   /oauth-clients                — create (returns client + plaintext secret ONCE)
 *  PATCH  /oauth-clients/:id            — update name/description/redirect_uris/allowed_scopes
 *  POST   /oauth-clients/:id/rotate-secret — rotate secret (returns plaintext ONCE)
 *  DELETE /oauth-clients/:id            — soft-delete (sets disabled_at); returns 204
 */

import { Router } from 'express';
import type { Request, Response, NextFunction } from 'express';
import { requireAuth } from '../middleware/requireAuth.js';
import type { ActorContext } from '../services/oauth/oauth-client.service.js';

export const oauthClientsRouter = Router();

// ---------------------------------------------------------------------------
// Helper — extract actor context from the session.
// ---------------------------------------------------------------------------

function actorContext(req: Request): ActorContext {
  return {
    actorUserId: (req.session as any).userId as number,
    actorRole: (req.session as any).role as string,
  };
}

// ---------------------------------------------------------------------------
// All oauth-client routes require authentication (no admin role required).
// ---------------------------------------------------------------------------

oauthClientsRouter.use('/oauth-clients', requireAuth);

// ---------------------------------------------------------------------------
// GET /oauth-clients — list clients (filtered by ownership for non-admins)
// ---------------------------------------------------------------------------

oauthClientsRouter.get('/oauth-clients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const clients = await req.services.oauthClients.list(actorContext(req));
    res.json(clients);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /oauth-clients — create (plaintext secret returned once)
// ---------------------------------------------------------------------------

oauthClientsRouter.post('/oauth-clients', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const actor = actorContext(req);
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
      actor.actorUserId,
      actor,
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

oauthClientsRouter.patch('/oauth-clients/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const actor = actorContext(req);
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

    const client = await req.services.oauthClients.update(id, patch as any, actor.actorUserId, actor);
    res.json(client);
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'OAuth client not found' });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /oauth-clients/:id/rotate-secret — rotate secret (plaintext returned once)
// ---------------------------------------------------------------------------

oauthClientsRouter.post('/oauth-clients/:id/rotate-secret', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const actor = actorContext(req);
    const { plaintextSecret } = await req.services.oauthClients.rotateSecret(id, actor.actorUserId, actor);
    res.json({ client_secret: plaintextSecret });
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'OAuth client not found' });
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /oauth-clients/:id — soft delete (sets disabled_at); returns 204
// ---------------------------------------------------------------------------

oauthClientsRouter.delete('/oauth-clients/:id', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid id' });

    const actor = actorContext(req);
    await req.services.oauthClients.disable(id, actor.actorUserId, actor);
    res.status(204).send();
  } catch (err: any) {
    if (err?.code === 'P2025') return res.status(404).json({ error: 'OAuth client not found' });
    next(err);
  }
});
