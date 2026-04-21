import { Router } from 'express';
import { prisma } from '../../services/prisma.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { AppError } from '../../errors.js';

export const adminUsersRouter = Router();

// GET /admin/users/:id — get a single user with logins and external accounts
adminUsersRouter.get('/users/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });

    const user = await prisma.user.findUnique({
      where: { id },
      include: {
        logins: true,
        external_accounts: { orderBy: { created_at: 'asc' } },
        cohort: { select: { id: true, name: true } },
      },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    res.json({
      id: user.id,
      email: user.primary_email,
      displayName: user.display_name,
      role: user.role,
      cohort: user.cohort ? { id: user.cohort.id, name: user.cohort.name } : null,
      createdAt: user.created_at,
      updatedAt: user.updated_at,
      logins: user.logins.map((l) => ({
        id: l.id,
        provider: l.provider,
        providerUserId: l.provider_user_id,
        providerEmail: l.provider_email ?? null,
        providerUsername: l.provider_username ?? null,
        createdAt: l.created_at,
      })),
      externalAccounts: user.external_accounts.map((a) => ({
        id: a.id,
        type: a.type,
        status: a.status,
        externalId: a.external_id ?? null,
        statusChangedAt: a.status_changed_at ?? null,
        scheduledDeleteAt: a.scheduled_delete_at ?? null,
        createdAt: a.created_at,
      })),
    });
  } catch (err) {
    next(err);
  }
});

// GET /admin/users/:id/pike13 — fetch a user's live Pike13 record (fail-soft)
adminUsersRouter.get('/users/:id/pike13', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });

    const user = await prisma.user.findUnique({
      where: { id },
      include: { external_accounts: { where: { type: 'pike13' } } },
    });
    if (!user) return res.status(404).json({ error: 'User not found' });

    const pike13Acct = user.external_accounts?.[0];
    if (!pike13Acct?.external_id) return res.json({ present: false });

    try {
      const person = await req.services.pike13Client.getPerson(
        Number(pike13Acct.external_id),
      );
      return res.json({ present: true, person });
    } catch (err: any) {
      return res.json({ present: true, error: err.message ?? 'Pike13 API error' });
    }
  } catch (err) {
    next(err);
  }
});

// GET /admin/users - list all users
adminUsersRouter.get('/users', async (req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { is_active: true },
      orderBy: { created_at: 'desc' },
      include: {
        logins: { select: { provider: true, provider_username: true, provider_email: true } },
        cohort: { select: { id: true, name: true } },
        external_accounts: { select: { type: true, external_id: true, status: true } },
      },
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

// DELETE /admin/users/:id - soft-delete a user (is_active=false) and emit audit event
adminUsersRouter.delete('/users/:id', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });

    const actorId = (req.session as any).userId as number;
    if (id === actorId) return res.status(403).json({ error: 'Cannot delete own account' });

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { is_active: false } });
      await tx.auditEvent.create({
        data: { action: 'delete_user', actor_user_id: actorId, target_user_id: id },
      });
    });

    res.json({ success: true });
  } catch (err: any) {
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
          email: l.provider_email ?? null,
        }))
      : [],
    cohort: user.cohort ? { id: user.cohort.id, name: user.cohort.name } : null,
    externalAccountTypes: Array.isArray(user.external_accounts)
      ? [...new Set(user.external_accounts.map((a: any) => a.type))]
      : [],
    externalAccounts: Array.isArray(user.external_accounts)
      ? user.external_accounts.map((a: any) => ({
          type: a.type,
          externalId: a.external_id ?? null,
          status: a.status,
        }))
      : [],
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}
