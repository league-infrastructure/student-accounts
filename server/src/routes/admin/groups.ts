/**
 * Admin groups routes (Sprint 012 T004).
 *
 * All routes are mounted under /admin by adminRouter in index.ts. Every
 * handler runs behind requireAuth + requireRole('admin') enforced upstream.
 *
 * Endpoints:
 *   GET    /admin/groups                              — list with member counts
 *   POST   /admin/groups                              — create
 *   GET    /admin/groups/:id                          — single group
 *   PUT    /admin/groups/:id                          — update name/description
 *   DELETE /admin/groups/:id                          — delete (cascades)
 *   GET    /admin/groups/:id/members                  — members with external accounts
 *   POST   /admin/groups/:id/members                  — add member {userId}
 *   DELETE /admin/groups/:id/members/:userId          — remove member
 *   GET    /admin/groups/:id/user-search?q=&limit=    — add-member autocomplete
 *   GET    /admin/users/:id/groups                    — user's memberships
 *   POST   /admin/groups/:id/bulk-provision           — {accountType}
 *   POST   /admin/groups/:id/bulk-suspend-all         — no body
 *   POST   /admin/groups/:id/bulk-remove-all          — no body
 *
 * Error mapping:
 *   AppError subclasses     → their own statusCode.
 *   AnthropicAdminWriteDisabledError / ClaudeTeamWriteDisabledError → 422.
 *   AnthropicAdminApiError / ClaudeTeamApiError → 502.
 *   WorkspaceApiError      → 502.
 *   Unknown errors         → fall through to global errorHandler (500).
 */

import { Router } from 'express';
import { AppError } from '../../errors.js';
import { WorkspaceApiError } from '../../services/google-workspace/google-workspace-admin.client.js';
import type { AccountType } from '../../services/bulk-account.shared.js';

export const adminGroupsRouter = Router();

const VALID_ACCOUNT_TYPES: AccountType[] = ['workspace', 'claude'];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function handleError(err: unknown, res: any, next: any) {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  if (err instanceof WorkspaceApiError) {
    return res.status(502).json({ error: err.message });
  }
  const name = (err as any)?.constructor?.name ?? (err as any)?.name ?? '';
  if (name === 'AnthropicAdminWriteDisabledError' || name === 'ClaudeTeamWriteDisabledError') {
    return res.status(422).json({
      error:
        'Anthropic write operations are disabled. Set CLAUDE_TEAM_WRITE_ENABLED=1 in the server environment and restart.',
    });
  }
  if (name === 'AnthropicAdminApiError' || name === 'ClaudeTeamApiError') {
    return res.status(502).json({ error: `Anthropic API error: ${(err as Error).message}` });
  }
  return next(err);
}

function parseIntParam(raw: string, label = 'id'): number | null {
  const n = parseInt(raw, 10);
  return Number.isNaN(n) ? null : n;
}

// ---------------------------------------------------------------------------
// GET /admin/groups
// ---------------------------------------------------------------------------

adminGroupsRouter.get('/groups', async (req, res, next) => {
  try {
    const groups = await req.services.groups.findAll();
    return res.json(
      groups.map((g) => ({
        id: g.id,
        name: g.name,
        description: g.description,
        memberCount: g.memberCount,
        createdAt: g.createdAt,
      })),
    );
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/groups
// ---------------------------------------------------------------------------

adminGroupsRouter.post('/groups', async (req, res, next) => {
  try {
    const { name, description } = req.body as {
      name?: unknown;
      description?: unknown;
    };

    if (typeof name !== 'string') {
      return res.status(422).json({ error: 'Group name must not be blank.' });
    }
    const descInput =
      typeof description === 'string'
        ? description
        : description === null || description === undefined
          ? null
          : undefined;

    const actorId = (req.session as any).userId as number;
    const g = await req.services.groups.create(
      { name, description: descInput ?? null },
      actorId,
    );

    return res.status(201).json({
      id: g.id,
      name: g.name,
      description: g.description,
      memberCount: 0,
      createdAt: g.created_at,
    });
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/groups/:id
// ---------------------------------------------------------------------------

adminGroupsRouter.get('/groups/:id', async (req, res, next) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid group id' });

    const g = await req.services.groups.findById(id);
    return res.json({
      id: g.id,
      name: g.name,
      description: g.description,
      createdAt: g.created_at,
      updatedAt: (g as any).updated_at,
    });
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// PUT /admin/groups/:id
// ---------------------------------------------------------------------------

adminGroupsRouter.put('/groups/:id', async (req, res, next) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid group id' });

    const { name, description } = req.body as {
      name?: unknown;
      description?: unknown;
    };

    const updates: { name?: string; description?: string | null } = {};
    if (name !== undefined) {
      if (typeof name !== 'string') {
        return res.status(422).json({ error: 'Group name must be a string.' });
      }
      updates.name = name;
    }
    if (description !== undefined) {
      if (description !== null && typeof description !== 'string') {
        return res
          .status(400)
          .json({ error: 'description must be a string or null.' });
      }
      updates.description = description as string | null;
    }

    const actorId = (req.session as any).userId as number;
    const g = await req.services.groups.update(id, updates, actorId);
    return res.json({
      id: g.id,
      name: g.name,
      description: g.description,
      createdAt: g.created_at,
      updatedAt: (g as any).updated_at,
    });
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/groups/:id
// ---------------------------------------------------------------------------

adminGroupsRouter.delete('/groups/:id', async (req, res, next) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid group id' });

    const actorId = (req.session as any).userId as number;
    await req.services.groups.delete(id, actorId);
    return res.status(204).send();
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/groups/:id/members
// ---------------------------------------------------------------------------

adminGroupsRouter.get('/groups/:id/members', async (req, res, next) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid group id' });
    const detail = await req.services.groups.listMembers(id);
    return res.json(detail);
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/groups/:id/members
// ---------------------------------------------------------------------------

adminGroupsRouter.post('/groups/:id/members', async (req, res, next) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid group id' });

    const { userId } = req.body as { userId?: unknown };
    const parsed =
      typeof userId === 'number'
        ? userId
        : typeof userId === 'string'
          ? parseInt(userId, 10)
          : Number.NaN;
    if (!Number.isFinite(parsed)) {
      return res.status(400).json({ error: 'userId is required' });
    }

    const actorId = (req.session as any).userId as number;
    await req.services.groups.addMember(id, parsed, actorId);
    return res.status(201).json({ groupId: id, userId: parsed });
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/groups/:id/members/:userId
// ---------------------------------------------------------------------------

adminGroupsRouter.delete(
  '/groups/:id/members/:userId',
  async (req, res, next) => {
    try {
      const id = parseIntParam(req.params.id);
      if (id === null) return res.status(400).json({ error: 'Invalid group id' });
      const userId = parseIntParam(req.params.userId);
      if (userId === null)
        return res.status(400).json({ error: 'Invalid user id' });

      const actorId = (req.session as any).userId as number;
      await req.services.groups.removeMember(id, userId, actorId);
      return res.status(204).send();
    } catch (err) {
      handleError(err, res, next);
    }
  },
);

// ---------------------------------------------------------------------------
// GET /admin/groups/:id/user-search
// ---------------------------------------------------------------------------

adminGroupsRouter.get('/groups/:id/user-search', async (req, res, next) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid group id' });

    const q = typeof req.query.q === 'string' ? req.query.q : '';
    const limitRaw =
      typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : 25;
    const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.min(limitRaw, 100) : 25;

    const hits = await req.services.groups.searchUsersNotInGroup(id, q, limit);
    return res.json(hits);
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/users/:id/groups
// ---------------------------------------------------------------------------

adminGroupsRouter.get('/users/:id/groups', async (req, res, next) => {
  try {
    const userId = parseIntParam(req.params.id);
    if (userId === null)
      return res.status(400).json({ error: 'Invalid user id' });
    const groups = await req.services.groups.listGroupsForUser(userId);
    return res.json(groups);
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/groups/:id/bulk-provision
// ---------------------------------------------------------------------------

adminGroupsRouter.post('/groups/:id/bulk-provision', async (req, res, next) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid group id' });

    const { accountType } = req.body as { accountType?: string };
    if (!accountType || !VALID_ACCOUNT_TYPES.includes(accountType as AccountType)) {
      return res.status(400).json({
        error: `Missing or invalid accountType; must be one of: ${VALID_ACCOUNT_TYPES.join(', ')}`,
      });
    }

    const actorId = (req.session as any).userId as number;
    const result = await req.services.bulkGroup.provisionGroup(
      id,
      accountType as AccountType,
      actorId,
    );
    const status =
      result.failed.length > 0 && result.succeeded.length > 0 ? 207 : 200;
    return res.status(status).json(result);
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/groups/:id/bulk-suspend-all
// ---------------------------------------------------------------------------

adminGroupsRouter.post('/groups/:id/bulk-suspend-all', async (req, res, next) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid group id' });
    const actorId = (req.session as any).userId as number;
    const result = await req.services.bulkGroup.suspendAllInGroup(id, actorId);
    const status =
      result.failed.length > 0 && result.succeeded.length > 0 ? 207 : 200;
    return res.status(status).json(result);
  } catch (err) {
    handleError(err, res, next);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/groups/:id/bulk-remove-all
// ---------------------------------------------------------------------------

adminGroupsRouter.post('/groups/:id/bulk-remove-all', async (req, res, next) => {
  try {
    const id = parseIntParam(req.params.id);
    if (id === null) return res.status(400).json({ error: 'Invalid group id' });
    const actorId = (req.session as any).userId as number;
    const result = await req.services.bulkGroup.removeAllInGroup(id, actorId);
    const status =
      result.failed.length > 0 && result.succeeded.length > 0 ? 207 : 200;
    return res.status(status).json(result);
  } catch (err) {
    handleError(err, res, next);
  }
});
