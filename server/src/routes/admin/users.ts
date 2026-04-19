import { Router } from 'express';
import { prisma } from '../../services/prisma.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { AppError } from '../../errors.js';

export const adminUsersRouter = Router();

// GET /admin/users - list all users
adminUsersRouter.get('/users', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { created_at: 'desc' },
      include: { logins: { select: { provider: true, provider_username: true } } },
    });
    res.json(users.map(serializeUser));
  } catch (err) {
    next(err);
  }
});

// POST /admin/users - create a user
adminUsersRouter.post('/users', async (req, res, next) => {
  try {
    const { email, displayName, role } = req.body;
    if (!email) return res.status(400).json({ error: 'Email is required' });
    const user = await req.services.users.create({ email, displayName, role });
    res.status(201).json(serializeUser(user));
  } catch (err: any) {
    if (err.code === 'P2002') {
      return res.status(409).json({ error: 'User with this email already exists' });
    }
    next(err);
  }
});

// PUT /admin/users/:id - update a user
adminUsersRouter.put('/users/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    const { email, displayName, role } = req.body;
    const user = await req.services.users.update(id, { email, displayName, role });
    res.json(serializeUser(user));
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    next(err);
  }
});

// DELETE /admin/users/:id - delete a user
adminUsersRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    await req.services.users.delete(id);
    res.status(204).end();
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    next(err);
  }
});

// POST /admin/users/:id/impersonate — start impersonating a user (admin only)
adminUsersRouter.post('/users/:id/impersonate', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    const realAdminId = (req.realAdmin as any)?.id ?? (req.user as any)?.id;

    if (realAdminId === targetId) {
      return res.status(400).json({ error: 'Cannot impersonate yourself' });
    }

    const target = await prisma.user.findUnique({ where: { id: targetId } });
    if (!target) {
      return res.status(404).json({ error: 'User not found' });
    }

    req.session.impersonatingUserId = target.id;
    req.session.realAdminId = realAdminId;

    req.session.save((err) => {
      if (err) return next(err);
      res.json({
        ok: true,
        impersonating: {
          id: target.id,
          displayName: target.display_name,
          email: target.primary_email,
          // Map domain role to legacy string
          role: target.role === 'admin' ? 'ADMIN' : target.role === 'staff' ? 'STAFF' : 'USER',
        },
      });
    });
  } catch (err) {
    next(err);
  }
});

// POST /admin/stop-impersonating — stop impersonation and restore real admin session.
adminUsersRouter.post('/stop-impersonating', requireAuth, async (req, res, next) => {
  if (!req.session.impersonatingUserId) {
    return res.status(400).json({ error: 'Not impersonating' });
  }

  try {
    delete req.session.impersonatingUserId;
    delete req.session.realAdminId;

    req.session.save((err) => {
      if (err) return next(err);
      res.json({ ok: true });
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/provision-claude
// Calls ClaudeProvisioningService.provision(userId, actorId, tx) inside a
// prisma.$transaction. Returns 201 with the new ExternalAccount on success.
// Returns 404 if the user does not exist.
// Returns 409 if the user already has an active claude ExternalAccount.
// Returns 422 if the user has no active workspace ExternalAccount.
// ---------------------------------------------------------------------------

adminUsersRouter.post('/users/:id/provision-claude', async (req, res, next) => {
  try {
    const userId = parseInt(req.params.id, 10);
    if (isNaN(userId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }
    const actorId = (req.session as any).userId as number;

    const account = await (prisma as any).$transaction(async (tx: any) => {
      return req.services.claudeProvisioning.provision(userId, actorId, tx);
    });

    return res.status(201).json({
      id: account.id,
      userId: account.user_id,
      type: account.type,
      status: account.status,
      externalId: account.external_id,
      statusChangedAt: account.status_changed_at,
    });
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

/** Serialize a domain User to the legacy shape callers/tests expect. */
function serializeUser(user: any) {
  return {
    id: user.id,
    email: user.primary_email,
    displayName: user.display_name,
    // Map domain role to legacy string for backward compatibility
    role: user.role === 'admin' ? 'ADMIN' : user.role === 'staff' ? 'STAFF' : 'USER',
    avatarUrl: null,
    provider: null,
    providerId: null,
    providers: Array.isArray(user.logins)
      ? user.logins.map((l: any) => ({
          provider: l.provider,
          username: l.provider_username ?? null,
        }))
      : [],
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}
