/**
 * Admin cohorts routes (Sprint 004 T009).
 *
 * All routes are mounted under /admin by the adminRouter in index.ts, so the
 * actual paths are:
 *   GET  /admin/cohorts
 *   POST /admin/cohorts
 *
 * requireAuth + requireRole('admin') are applied by the adminRouter before
 * this router is invoked — individual handlers do not re-apply those guards.
 *
 * Error mapping:
 *   AppError subclasses  → their own statusCode
 *   WorkspaceApiError    → 502 (Google Admin SDK failure)
 *   Unknown errors       → fall through to the global errorHandler (500)
 */

import { Router } from 'express';
import { prisma } from '../../services/prisma.js';
import { AppError } from '../../errors.js';
import { WorkspaceApiError } from '../../services/google-workspace/google-workspace-admin.client.js';
import { adminBus } from '../../services/change-bus.js';

export const adminCohortsRouter = Router();

// ---------------------------------------------------------------------------
// GET /admin/cohorts
// Returns all Cohorts ordered by created_at descending.
// Response shape per item: { id, name, google_ou_path, createdAt }
// ---------------------------------------------------------------------------

adminCohortsRouter.get('/cohorts', async (_req, res, next) => {
  try {
    const cohorts = await (prisma as any).cohort.findMany({
      orderBy: { created_at: 'desc' },
      include: { _count: { select: { users: true } } },
    });

    const result = cohorts.map((c: any) => ({
      id: c.id,
      name: c.name,
      google_ou_path: c.google_ou_path,
      createdAt: c.created_at,
      memberCount: c._count.users,
    }));

    res.json(result);
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/cohorts
// Accepts { name: string }. Calls CohortService.createWithOU(name, actorId).
// Returns 201 with the new cohort on success.
// Returns 409 if name is duplicate.
// Returns 422 if name is blank.
// Returns 502 if the Admin SDK fails.
// ---------------------------------------------------------------------------

adminCohortsRouter.post('/cohorts', async (req, res, next) => {
  try {
    const { name } = req.body as { name?: unknown };

    if (typeof name !== 'string' || name.trim() === '') {
      return res.status(422).json({ error: 'Cohort name must not be blank.' });
    }

    const actorId = (req.session as any).userId as number;

    const cohort = await req.services.cohorts.createWithOU(name, actorId);

    adminBus.notify('cohorts');

    return res.status(201).json({
      id: cohort.id,
      name: cohort.name,
      google_ou_path: cohort.google_ou_path,
      createdAt: (cohort as any).created_at,
    });
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    if (err instanceof WorkspaceApiError) {
      return res.status(502).json({ error: err.message });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/cohorts/:id/sync-to-group
//
// Copies the cohort's active students into a Group whose name matches the
// cohort name. Creates the group if it doesn't exist. Idempotent — only
// adds users who aren't already members. Account management (workspace,
// Claude, LLM proxy) happens on the resulting group page.
// ---------------------------------------------------------------------------

adminCohortsRouter.post('/cohorts/:id/sync-to-group', async (req, res, next) => {
  try {
    const cohortId = parseInt(req.params.id, 10);
    if (isNaN(cohortId)) {
      return res.status(400).json({ error: 'Invalid cohort id' });
    }

    const actorId = (req.session as any).userId as number;

    const result = await req.services.cohorts.syncToGroup(cohortId, actorId);

    adminBus.notify('groups');
    // The new group's members show up in each student's user detail page,
    // so notify 'users' too.
    adminBus.notify('users');

    return res.status(200).json(result);
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /admin/cohorts/:id/passphrase
// Creates or rotates the signup passphrase for a cohort.
// Body: { plaintext?: string; grantLlmProxy: boolean }
// Returns 201 { plaintext, expiresAt, grantLlmProxy, createdAt }
// ---------------------------------------------------------------------------

adminCohortsRouter.post('/cohorts/:id/passphrase', async (req, res, next) => {
  try {
    const cohortId = parseInt(req.params.id, 10);
    if (isNaN(cohortId) || cohortId <= 0) {
      return res.status(400).json({ error: 'Invalid cohort id' });
    }

    const cohort = await (prisma as any).cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) {
      return res.status(404).json({ error: 'Cohort not found' });
    }

    const { plaintext, grantLlmProxy } = req.body as {
      plaintext?: unknown;
      grantLlmProxy?: unknown;
    };

    if (typeof grantLlmProxy !== 'boolean') {
      return res.status(400).json({ error: 'grantLlmProxy must be a boolean' });
    }

    const actorId = (req.session as any).userId as number;
    const record = await req.services.passphrases.create(
      { kind: 'cohort', id: cohortId },
      {
        plaintext: typeof plaintext === 'string' ? plaintext : undefined,
        grantLlmProxy,
      },
      actorId,
    );

    adminBus.notify('cohorts');

    return res.status(201).json({
      plaintext: record.plaintext,
      expiresAt: record.expiresAt,
      grantLlmProxy: record.grantLlmProxy,
      createdAt: record.createdAt,
    });
  } catch (err: any) {
    if (err instanceof AppError) {
      return res.status(err.statusCode).json({ error: err.message });
    }
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/cohorts/:id/passphrase
// Returns the active passphrase for a cohort, or 404 if none.
// ---------------------------------------------------------------------------

adminCohortsRouter.get('/cohorts/:id/passphrase', async (req, res, next) => {
  try {
    const cohortId = parseInt(req.params.id, 10);
    if (isNaN(cohortId) || cohortId <= 0) {
      return res.status(400).json({ error: 'Invalid cohort id' });
    }

    const cohort = await (prisma as any).cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) {
      return res.status(404).json({ error: 'Cohort not found' });
    }

    const record = await req.services.passphrases.getActive({ kind: 'cohort', id: cohortId });
    if (!record) {
      return res.status(404).json({ error: 'No active passphrase' });
    }

    return res.json({
      plaintext: record.plaintext,
      expiresAt: record.expiresAt,
      grantLlmProxy: record.grantLlmProxy,
      createdAt: record.createdAt,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// DELETE /admin/cohorts/:id/passphrase
// Revokes the active passphrase for a cohort. Idempotent.
// Returns 204.
// ---------------------------------------------------------------------------

adminCohortsRouter.delete('/cohorts/:id/passphrase', async (req, res, next) => {
  try {
    const cohortId = parseInt(req.params.id, 10);
    if (isNaN(cohortId) || cohortId <= 0) {
      return res.status(400).json({ error: 'Invalid cohort id' });
    }

    const cohort = await (prisma as any).cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) {
      return res.status(404).json({ error: 'Cohort not found' });
    }

    const actorId = (req.session as any).userId as number;
    await req.services.passphrases.revoke({ kind: 'cohort', id: cohortId }, actorId);

    adminBus.notify('cohorts');

    return res.status(204).send();
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /admin/cohorts/:id/members
// Returns cohort + active users with externalAccounts. Powers the
// read-only cohort detail view.
// ---------------------------------------------------------------------------

adminCohortsRouter.get('/cohorts/:id/members', async (req, res, next) => {
  try {
    const cohortId = parseInt(req.params.id, 10);
    if (isNaN(cohortId)) return res.status(400).json({ error: 'Invalid cohort id' });

    const cohort = await (prisma as any).cohort.findUnique({ where: { id: cohortId } });
    if (!cohort) return res.status(404).json({ error: 'Cohort not found' });

    const users = await (prisma as any).user.findMany({
      where: { cohort_id: cohortId, is_active: true },
      orderBy: { display_name: 'asc' },
      include: {
        external_accounts: { select: { type: true, status: true, external_id: true } },
      },
    });

    res.json({
      cohort: { id: cohort.id, name: cohort.name, google_ou_path: cohort.google_ou_path },
      users: users.map((u: any) => ({
        id: u.id,
        displayName: u.display_name,
        email: u.primary_email,
        role: u.role,
        externalAccounts: (u.external_accounts ?? []).map((a: any) => ({
          type: a.type,
          status: a.status,
          externalId: a.external_id,
        })),
      })),
    });
  } catch (err) {
    next(err);
  }
});
