import { Router } from 'express';
import { prisma } from '../../services/prisma';
import { requireAuth } from '../../middleware/requireAuth';

export const adminUsersRouter = Router();

// GET /admin/users - list all users with linked providers
adminUsersRouter.get('/users', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      orderBy: { createdAt: 'desc' },
      include: { providers: { select: { provider: true } } },
    });
    res.json(users);
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
    res.status(201).json(user);
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
    res.json(user);
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
// requireAdmin is already applied at the router level in admin/index.ts.
adminUsersRouter.post('/users/:id/impersonate', async (req, res, next) => {
  try {
    const targetId = parseInt(req.params.id, 10);
    if (isNaN(targetId)) {
      return res.status(400).json({ error: 'Invalid user id' });
    }

    // Determine the real admin's id (impersonating an impersonated session is not
    // allowed; use the outermost real admin if present).
    const realAdminId = (req.realAdmin as any)?.id ?? (req.user as any)?.id;

    // Reject self-impersonation
    if (realAdminId === targetId) {
      return res.status(400).json({ error: 'Cannot impersonate yourself' });
    }

    // Load target user
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
          displayName: target.displayName,
          email: target.email,
          role: target.role,
        },
      });
    });
  } catch (err) {
    next(err);
  }
});

// POST /admin/stop-impersonating — stop impersonation and restore real admin session.
// Guarded with requireAuth (not requireAdmin) so it remains callable even when
// impersonating a non-admin user. The admin/index.ts applies requireAdmin to all
// /admin routes, but requireAdmin already handles the impersonation case correctly
// (it checks req.realAdmin.role). The additional check on realAdminId ensures
// we only honour this endpoint when a genuine impersonation session is active.
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
