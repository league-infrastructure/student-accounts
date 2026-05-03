/**
 * Integration tests for PATCH /api/admin/users/:id/permissions (Sprint 027 T004).
 *
 * Covers:
 *  - allows_league_account=true → provisionUserIfNeeded called (stub injected).
 *  - allows_league_account=true but user already has workspace → provision not called.
 *  - allows_league_account=false → provision not called.
 *  - Other flags only (e.g. allows_llm_proxy=true) → provision not called.
 *  - Provisioning failure does not block the PATCH (returns 200, audit still written).
 *
 * WorkspaceProvisioningService is replaced with a stub injected into the
 * singleton registry — same pattern as users.provision-workspace.test.ts.
 */

import request from 'supertest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { FakeGoogleWorkspaceAdminClient } from '../../helpers/fake-google-workspace-admin.client.js';
import { WorkspaceProvisioningService } from '../../../../server/src/services/workspace-provisioning.service.js';
import { AuditService } from '../../../../server/src/services/audit.service.js';
import { ExternalAccountRepository } from '../../../../server/src/services/repositories/external-account.repository.js';
import { UserRepository } from '../../../../server/src/services/repositories/user.repository.js';
import { CohortRepository } from '../../../../server/src/services/repositories/cohort.repository.js';
import { makeUser, makeCohort, makeExternalAccount } from '../../helpers/factories.js';
import { vi } from 'vitest';

process.env.NODE_ENV = 'test';

import app, { registry } from '../../../../server/src/app.js';

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function cleanDb(): Promise<void> {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).userGroup.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
  await (prisma as any).group.deleteMany();
}

async function loginAs(
  email: string,
  role: 'student' | 'staff' | 'admin' = 'admin',
): Promise<ReturnType<typeof request.agent>> {
  const agent = request.agent(app);
  await agent.post('/api/auth/test-login').send({ email, role });
  return agent;
}

// ---------------------------------------------------------------------------
// Workspace provisioning stub helpers
// ---------------------------------------------------------------------------

/**
 * Inject a spy-backed WorkspaceProvisioningService into the registry.
 * Returns the `provision` spy and a cleanup function.
 *
 * When opts.rejects=true, the `provision` spy itself rejects immediately
 * (without opening a DB transaction) so the fail-soft test can verify that
 * a provisioning error does not affect the HTTP response or audit event.
 */
function injectFakeWorkspaceProvisioning(opts: {
  rejects?: boolean;
} = {}): { provisionSpy: ReturnType<typeof vi.fn>; restore: () => void } {
  const original = (registry as any).workspaceProvisioning;

  const fakeGoogle = new FakeGoogleWorkspaceAdminClient();

  const fakeService = new WorkspaceProvisioningService(
    fakeGoogle,
    ExternalAccountRepository,
    new AuditService(),
    UserRepository,
    CohortRepository,
  );

  // Spy on the provision method so we can assert call counts.
  // When rejects=true, override the implementation to reject immediately
  // without touching the DB, so we avoid SQLite write-lock contention.
  const provisionSpy = opts.rejects
    ? vi.spyOn(fakeService, 'provision').mockRejectedValue(
        new Error('Google API unavailable'),
      )
    : vi.spyOn(fakeService, 'provision');

  (registry as any).workspaceProvisioning = fakeService;

  return {
    provisionSpy,
    restore: () => {
      (registry as any).workspaceProvisioning = original;
    },
  };
}

// ---------------------------------------------------------------------------
// Setup / teardown
// ---------------------------------------------------------------------------

const STUDENT_DOMAIN = 'students.jointheleague.org';
let savedDomain: string | undefined;

beforeEach(async () => {
  await cleanDb();
  savedDomain = process.env.GOOGLE_STUDENT_DOMAIN;
  process.env.GOOGLE_STUDENT_DOMAIN = STUDENT_DOMAIN;
});

afterEach(() => {
  if (savedDomain !== undefined) {
    process.env.GOOGLE_STUDENT_DOMAIN = savedDomain;
  } else {
    delete process.env.GOOGLE_STUDENT_DOMAIN;
  }
});

afterAll(async () => {
  await cleanDb();
});

// ---------------------------------------------------------------------------
// Helpers for audit log assertions
// ---------------------------------------------------------------------------

async function getPermissionAuditEvents(userId: number) {
  return (prisma as any).auditEvent.findMany({
    where: { action: 'user_permission_changed', target_user_id: userId },
  });
}

// ===========================================================================
// allows_league_account=true → provisioning called
// ===========================================================================

describe('PATCH /api/admin/users/:id/permissions — allows_league_account=true triggers provisioning', () => {
  it('calls provision when allows_league_account transitions false→true and user has no workspace', async () => {
    const { provisionSpy, restore } = injectFakeWorkspaceProvisioning();
    try {
      await makeUser({ primary_email: 'admin-perm1@example.com', role: 'admin' });
      const cohort = await makeCohort({ google_ou_path: '/Students/Spring2025' });
      const student = await makeUser({
        primary_email: 'student-perm1@example.com',
        role: 'student',
        cohort_id: cohort.id,
        display_name: 'Alice Smith',
      });

      const agent = await loginAs('admin-perm1@example.com');
      const res = await agent
        .patch(`/api/admin/users/${student.id}/permissions`)
        .send({ allows_league_account: true });

      expect(res.status).toBe(200);
      expect(res.body.allowsLeagueAccount).toBe(true);

      // Allow async provisioning to complete.
      await new Promise((r) => setTimeout(r, 200));

      expect(provisionSpy).toHaveBeenCalledTimes(1);
      expect(provisionSpy.mock.calls[0][0]).toBe(student.id);
    } finally {
      restore();
    }
  });

  it('does not call provision when user already has an active workspace account', async () => {
    const { provisionSpy, restore } = injectFakeWorkspaceProvisioning();
    try {
      await makeUser({ primary_email: 'admin-perm2@example.com', role: 'admin' });
      const student = await makeUser({
        primary_email: 'student-perm2@example.com',
        role: 'student',
      });
      // Pre-existing workspace account.
      await makeExternalAccount(student, { type: 'workspace', status: 'active' });

      const agent = await loginAs('admin-perm2@example.com');
      const res = await agent
        .patch(`/api/admin/users/${student.id}/permissions`)
        .send({ allows_league_account: true });

      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 200));

      // provisionUserIfNeeded skips because account already exists.
      expect(provisionSpy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// allows_league_account=false → no provisioning
// ===========================================================================

describe('PATCH /api/admin/users/:id/permissions — allows_league_account=false does not provision', () => {
  it('does not call provision when allows_league_account=false', async () => {
    const { provisionSpy, restore } = injectFakeWorkspaceProvisioning();
    try {
      await makeUser({ primary_email: 'admin-perm3@example.com', role: 'admin' });
      const student = await makeUser({
        primary_email: 'student-perm3@example.com',
        role: 'student',
        allows_league_account: true, // already true
      });

      const agent = await loginAs('admin-perm3@example.com');
      const res = await agent
        .patch(`/api/admin/users/${student.id}/permissions`)
        .send({ allows_league_account: false });

      expect(res.status).toBe(200);
      expect(res.body.allowsLeagueAccount).toBe(false);

      await new Promise((r) => setTimeout(r, 200));

      expect(provisionSpy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// Other flags only → no provisioning
// ===========================================================================

describe('PATCH /api/admin/users/:id/permissions — other flags do not trigger provisioning', () => {
  it('does not call provision when only allows_oauth_client is toggled', async () => {
    const { provisionSpy, restore } = injectFakeWorkspaceProvisioning();
    try {
      await makeUser({ primary_email: 'admin-perm4@example.com', role: 'admin' });
      const student = await makeUser({ primary_email: 'student-perm4@example.com', role: 'student' });

      const agent = await loginAs('admin-perm4@example.com');
      const res = await agent
        .patch(`/api/admin/users/${student.id}/permissions`)
        .send({ allows_oauth_client: true });

      expect(res.status).toBe(200);
      expect(res.body.allowsOauthClient).toBe(true);

      await new Promise((r) => setTimeout(r, 200));

      expect(provisionSpy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });

  it('does not call provision when only allows_llm_proxy is toggled', async () => {
    const { provisionSpy, restore } = injectFakeWorkspaceProvisioning();
    try {
      await makeUser({ primary_email: 'admin-perm5@example.com', role: 'admin' });
      const student = await makeUser({ primary_email: 'student-perm5@example.com', role: 'student' });

      const agent = await loginAs('admin-perm5@example.com');
      const res = await agent
        .patch(`/api/admin/users/${student.id}/permissions`)
        .send({ allows_llm_proxy: true });

      expect(res.status).toBe(200);
      expect(res.body.allowsLlmProxy).toBe(true);

      await new Promise((r) => setTimeout(r, 200));

      expect(provisionSpy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// Provisioning failure → 200 still returned + audit written
// ===========================================================================

describe('PATCH /api/admin/users/:id/permissions — provisioning failure is fail-soft', () => {
  it('returns 200 and writes audit event even when provisioning fails', async () => {
    // provision spy rejects immediately without touching the DB.
    const { provisionSpy, restore } = injectFakeWorkspaceProvisioning({ rejects: true });
    try {
      await makeUser({ primary_email: 'admin-perm6@example.com', role: 'admin' });
      const student = await makeUser({
        primary_email: 'student-perm6@example.com',
        role: 'student',
      });

      const agent = await loginAs('admin-perm6@example.com');
      const res = await agent
        .patch(`/api/admin/users/${student.id}/permissions`)
        .send({ allows_league_account: true });

      // Response must be 200 regardless of provisioning outcome.
      expect(res.status).toBe(200);
      expect(res.body.allowsLeagueAccount).toBe(true);

      // Allow the async provisionUserIfNeeded promise to complete (fail-soft).
      await new Promise((r) => setTimeout(r, 200));

      // Provision was attempted (and the spy rejected).
      expect(provisionSpy).toHaveBeenCalledTimes(1);

      // Audit event was still written (setPermissions committed before provisioning).
      const events = await getPermissionAuditEvents(student.id);
      expect(events).toHaveLength(1);
      expect((events[0].details as any).after.allows_league_account).toBe(true);
    } finally {
      restore();
    }
  });
});

// ===========================================================================
// No-op (already true → true) → no provisioning flip
// ===========================================================================

describe('PATCH /api/admin/users/:id/permissions — no flip when already true', () => {
  it('does not call provision when allows_league_account was already true', async () => {
    const { provisionSpy, restore } = injectFakeWorkspaceProvisioning();
    try {
      await makeUser({ primary_email: 'admin-perm7@example.com', role: 'admin' });
      const student = await makeUser({
        primary_email: 'student-perm7@example.com',
        role: 'student',
        allows_league_account: true, // already true
      });

      const agent = await loginAs('admin-perm7@example.com');
      const res = await agent
        .patch(`/api/admin/users/${student.id}/permissions`)
        .send({ allows_league_account: true }); // no flip

      expect(res.status).toBe(200);

      await new Promise((r) => setTimeout(r, 200));

      // No transition false→true; provisioning must not fire.
      expect(provisionSpy).not.toHaveBeenCalled();
    } finally {
      restore();
    }
  });
});
