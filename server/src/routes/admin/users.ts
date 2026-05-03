import { Router } from 'express';
import { prisma } from '../../services/prisma.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { AppError } from '../../errors.js';
import { adminBus, userBus } from '../../services/change-bus.js';

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
    const now = new Date();
    const users = await prisma.user.findMany({
      where: { is_active: true },
      orderBy: { created_at: 'desc' },
      include: {
        logins: { select: { provider: true, provider_username: true, provider_email: true } },
        cohort: { select: { id: true, name: true } },
        external_accounts: { select: { type: true, external_id: true, status: true } },
        // Fetch at most one active (non-revoked, non-expired) LLM proxy token per user.
        llm_proxy_tokens: {
          where: { revoked_at: null, expires_at: { gt: now } },
          select: { id: true },
          take: 1,
        },
        // Count non-disabled OAuth clients created by this user.
        _count: {
          select: { oauth_clients_created: { where: { disabled_at: null } } },
        },
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
    adminBus.notify('users');
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
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });

    const { email, displayName, role } = req.body as {
      email?: string;
      displayName?: string;
      role?: string;
    };
    const actorId = (req.session as any).userId as number;

    // Admin-role guards — only fire when the caller is about to demote
    // somebody from admin. Role values are normalized server-side by
    // mapRole; we mirror that normalization here for the check.
    if (role !== undefined) {
      const normalized = normalizeRoleInput(role);
      if (normalized !== 'admin') {
        const target = await prisma.user.findUnique({ where: { id } });
        if (target?.role === 'admin') {
          // Self-demote guard: mirrors the delete-user flow.
          if (id === actorId) {
            return res.status(403).json({ error: 'Cannot demote your own account' });
          }
          // Last-admin guard: count active admins; refuse if this is the
          // only one.
          const adminCount = await prisma.user.count({
            where: { role: 'admin', is_active: true },
          });
          if (adminCount <= 1) {
            return res.status(409).json({ error: 'Cannot demote the last admin' });
          }
        }
      }
    }

    const user = await req.services.users.update(id, { email, displayName, role });
    adminBus.notify('users');
    userBus.notifyUser(id);
    res.json(serializeUser(user));
  } catch (err: any) {
    if (err.code === 'P2025') {
      return res.status(404).json({ error: 'User not found' });
    }
    next(err);
  }
});

/**
 * Mirror of user.service.mapRole for the admin-role guards in PUT
 * /users/:id. Kept inline so the handler doesn't depend on the
 * service's private helper; the update call still runs the real
 * mapRole for persistence.
 */
function normalizeRoleInput(role: string): 'admin' | 'staff' | 'student' {
  if (role === 'ADMIN') return 'admin';
  if (role === 'USER') return 'student';
  if (role === 'admin' || role === 'staff' || role === 'student') return role;
  return 'student';
}

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

    adminBus.notify('users');
    userBus.notifyUser(id);
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
// GET /admin/pending-users — list users with approval_status='pending'
// ---------------------------------------------------------------------------

adminUsersRouter.get('/pending-users', async (_req, res, next) => {
  try {
    const users = await prisma.user.findMany({
      where: { is_active: true, approval_status: 'pending' },
      orderBy: { created_at: 'asc' },
      include: {
        logins: { select: { provider: true, provider_email: true, provider_username: true } },
        cohort: { select: { id: true, name: true } },
      },
    });
    res.json(
      users.map((u) => ({
        id: u.id,
        email: u.primary_email,
        displayName: u.display_name,
        createdAt: u.created_at,
        cohort: u.cohort ? { id: u.cohort.id, name: u.cohort.name } : null,
        logins: u.logins.map((l) => ({
          provider: l.provider,
          email: l.provider_email,
          username: l.provider_username,
        })),
      })),
    );
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/approve — flip approval_status to 'approved' and
// optionally provision the League workspace account + LLM proxy token
// at the same moment.
//
// Body (all optional):
//   { provisionWorkspace?: boolean, grantLlmProxy?: boolean }
//
// The approval itself is transactional. The optional provisioning calls
// run AFTER the approval commits and each is independently fail-soft —
// a workspace failure does not block an LLM-proxy grant and neither
// affects the approval. The response reports what happened.
// ---------------------------------------------------------------------------

const LLM_PROXY_DEFAULT_TOKEN_LIMIT = 1_000_000;
const LLM_PROXY_DEFAULT_EXPIRY_DAYS = 30;

adminUsersRouter.post('/users/:id/approve', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });
    const actorId = (req.session as any).userId as number;

    const body = (req.body ?? {}) as {
      provisionWorkspace?: unknown;
      grantLlmProxy?: unknown;
    };
    const provisionWorkspace = body.provisionWorkspace === true;
    const grantLlmProxy = body.grantLlmProxy === true;

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });
    if (user.approval_status === 'approved') {
      return res.status(409).json({ error: 'User is already approved' });
    }

    await prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { approval_status: 'approved' } });
      await tx.auditEvent.create({
        data: {
          action: 'approve_user',
          actor_user_id: actorId,
          target_user_id: id,
          target_entity_type: 'User',
          target_entity_id: String(id),
        },
      });
    });

    // Optional side actions — fail-soft, each in its own transaction.
    const response: {
      ok: true;
      workspace?: { provisioned: boolean; error?: string };
      llmProxy?: { granted: boolean; error?: string };
    } = { ok: true };

    if (provisionWorkspace) {
      try {
        await prisma.$transaction(async (tx: any) => {
          await req.services.workspaceProvisioning.provision(id, actorId, tx);
        });
        response.workspace = { provisioned: true };
      } catch (err: any) {
        response.workspace = {
          provisioned: false,
          error: err?.message ?? String(err),
        };
      }
    }

    if (grantLlmProxy) {
      try {
        const expiresAt = new Date(
          Date.now() + LLM_PROXY_DEFAULT_EXPIRY_DAYS * 24 * 60 * 60 * 1000,
        );
        await req.services.llmProxyTokens.grant(
          id,
          { expiresAt, tokenLimit: LLM_PROXY_DEFAULT_TOKEN_LIMIT },
          actorId,
          { scope: 'single' },
        );
        response.llmProxy = { granted: true };
      } catch (err: any) {
        response.llmProxy = {
          granted: false,
          error: err?.message ?? String(err),
        };
      }
    }

    adminBus.notify('pending-users');
    adminBus.notify('users');
    userBus.notifyUser(id);

    res.json(response);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/users/:id/deny-approval — deny a pending user.
//
// Two flavors, distinguished by request body:
//
//   { }                  → soft deny: is_active=false, approval_status='rejected'.
//                          If the user later re-OAuths, the sign-in handler
//                          reactivates them back into the approval queue.
//
//   { permanent: true }  → permanent deny: is_active=false,
//                          approval_status='rejected_permanent'. Re-OAuth
//                          attempts are refused — the user lands on the
//                          login page with a "permanently denied" message
//                          and never gets a session. Only an admin manually
//                          flipping the status can undo this.
// ---------------------------------------------------------------------------

adminUsersRouter.post('/users/:id/deny-approval', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });
    const actorId = (req.session as any).userId as number;
    const permanent = (req.body as { permanent?: boolean } | undefined)?.permanent === true;
    const newStatus = permanent ? 'rejected_permanent' : 'rejected';

    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) return res.status(404).json({ error: 'User not found' });

    await prisma.$transaction(async (tx) => {
      await tx.user.update({
        where: { id },
        data: { is_active: false, approval_status: newStatus },
      });
      await tx.auditEvent.create({
        data: {
          action: 'deny_user_approval',
          actor_user_id: actorId,
          target_user_id: id,
          target_entity_type: 'User',
          target_entity_id: String(id),
          details: { permanent },
        },
      });
    });

    adminBus.notify('pending-users');
    adminBus.notify('users');
    userBus.notifyUser(id);

    res.json({ ok: true, permanent });
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

    adminBus.notify('users');
    userBus.notifyUser(userId);

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
    // Recognize Anthropic/Claude client errors without importing the class
    // (avoids a dependency cycle between routes/ and services/anthropic/).
    const name = err?.constructor?.name ?? err?.name ?? '';
    if (name === 'AnthropicAdminWriteDisabledError' || name === 'ClaudeTeamWriteDisabledError') {
      return res.status(422).json({
        error:
          'Anthropic write operations are disabled. Set CLAUDE_TEAM_WRITE_ENABLED=1 in the server environment and restart.',
      });
    }
    if (name === 'AnthropicAdminApiError' || name === 'ClaudeTeamApiError') {
      return res.status(502).json({ error: `Anthropic API error: ${err.message}` });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// PATCH /admin/users/:id/permissions — update per-user permission flags
//
// Body (all optional):
//   { allows_oauth_client?: boolean, allows_llm_proxy?: boolean, allows_league_account?: boolean }
//
// Returns 200 with { allowsOauthClient, allowsLlmProxy, allowsLeagueAccount }.
// Returns 400 if any provided field is not a boolean.
// Returns 404 if the user does not exist.
// ---------------------------------------------------------------------------

adminUsersRouter.patch('/users/:id/permissions', async (req, res, next) => {
  try {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) return res.status(400).json({ error: 'Invalid user id' });

    const actorId = (req.session as any).userId as number;
    const body = (req.body ?? {}) as Record<string, unknown>;

    // Validate each recognised field — must be boolean when present.
    const PERMISSION_FIELDS = ['allows_oauth_client', 'allows_llm_proxy', 'allows_league_account'] as const;
    for (const field of PERMISSION_FIELDS) {
      if (field in body && typeof body[field] !== 'boolean') {
        return res.status(400).json({ error: `Field '${field}' must be a boolean` });
      }
    }

    const patch: {
      allows_oauth_client?: boolean;
      allows_llm_proxy?: boolean;
      allows_league_account?: boolean;
    } = {};
    for (const field of PERMISSION_FIELDS) {
      if (field in body) {
        (patch as any)[field] = body[field] as boolean;
      }
    }

    const permissions = await req.services.users.setPermissions(id, patch, actorId);

    adminBus.notify('users');
    userBus.notifyUser(id);

    res.json(permissions);
  } catch (err: any) {
    if (err instanceof AppError && err.statusCode === 404) {
      return res.status(404).json({ error: 'User not found' });
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
    // true when the user has at least one active (non-revoked, non-expired) LLM proxy token.
    llmProxyEnabled: Array.isArray(user.llm_proxy_tokens)
      ? user.llm_proxy_tokens.length > 0
      : false,
    // count of non-disabled OAuth clients created by this user.
    oauthClientCount: user._count?.oauth_clients_created ?? 0,
    createdAt: user.created_at,
    updatedAt: user.updated_at,
  };
}
