/**
 * Integration tests for WorkspaceSyncService (Sprint 006 T006).
 *
 * Covers:
 *
 * CohortService.upsertByOUPath
 *  - Creates a new Cohort when none exists for the OU path.
 *  - Returns the existing Cohort unchanged when name matches.
 *  - Updates name when an existing Cohort has a different name.
 *  - Does not call createOU or any Google Admin SDK method.
 *
 * WorkspaceSyncService.syncCohorts
 *  - New OUs create Cohort rows.
 *  - Existing OUs with matching names return unchanged.
 *  - Empty OU list results in 0 cohorts upserted.
 *  - Records sync_cohorts_completed audit event.
 *
 * WorkspaceSyncService.syncStaff
 *  - New staff users are created with role=staff, created_via=workspace_sync.
 *  - Existing user with role=student is updated to role=staff.
 *  - Existing user with role=admin is NOT changed.
 *  - Existing user already role=staff remains unchanged.
 *  - GOOGLE_STAFF_OU_PATH absent → skips and returns staffUpserted=0.
 *  - Records sync_staff_completed audit event.
 *
 * WorkspaceSyncService.syncStudents
 *  - Root OU users get cohort_id=null and role=student.
 *  - Cohort OU users get cohort_id set.
 *  - Admin role is preserved (not set to student).
 *  - Staff role is set to student (staff sync and student sync are separate concerns).
 *  - Workspace ExternalAccounts not seen in any OU are flagged removed.
 *  - workspace_sync_flagged audit event recorded for each flagged account.
 *  - Records sync_students_completed audit event.
 *
 * WorkspaceSyncService.syncAll
 *  - Runs all three operations and returns combined report.
 *  - If syncCohorts throws, syncStaff and syncStudents still run.
 *  - Records sync_all_completed audit event.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { CohortService } from '../../../server/src/services/cohort.service.js';
import { WorkspaceSyncService } from '../../../server/src/services/workspace-sync.service.js';
import { UserRepository } from '../../../server/src/services/repositories/user.repository.js';
import { ExternalAccountRepository } from '../../../server/src/services/repositories/external-account.repository.js';
import { CohortRepository } from '../../../server/src/services/repositories/cohort.repository.js';
import { FakeGoogleWorkspaceAdminClient } from '../helpers/fake-google-workspace-admin.client.js';
import { WorkspaceApiError } from '../../../server/src/services/google-workspace/google-workspace-admin.client.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function clearDb() {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();
}

function makeServices(fake: FakeGoogleWorkspaceAdminClient) {
  const audit = new AuditService();
  const cohortService = new CohortService(prisma, audit);
  const svc = new WorkspaceSyncService(
    prisma,
    fake,
    cohortService,
    UserRepository,
    ExternalAccountRepository,
    CohortRepository,
    audit,
  );
  return { svc, cohortService, audit };
}

async function findCohortByOUPath(ouPath: string) {
  return (prisma as any).cohort.findFirst({ where: { google_ou_path: ouPath } });
}

async function findUserByEmail(email: string) {
  return (prisma as any).user.findFirst({ where: { primary_email: email } });
}

async function findAuditEvents(action: string) {
  return (prisma as any).auditEvent.findMany({ where: { action } });
}

async function createWorkspaceAccount(userId: number, status = 'active') {
  // external_id on workspace rows is the League email — mirror the real
  // provisioning service by defaulting it to the user's primary_email.
  const u = await (prisma as any).user.findUnique({ where: { id: userId } });
  return (prisma as any).externalAccount.create({
    data: { user_id: userId, type: 'workspace', status, external_id: u?.primary_email ?? null },
  });
}

// ---------------------------------------------------------------------------
// Environment variable management
// ---------------------------------------------------------------------------

let savedStaffOuPath: string | undefined;
let savedStudentOuRoot: string | undefined;

beforeEach(async () => {
  await clearDb();
  savedStaffOuPath = process.env.GOOGLE_STAFF_OU_PATH;
  savedStudentOuRoot = process.env.GOOGLE_STUDENT_OU_ROOT;
  // Use predictable defaults for all tests
  delete process.env.GOOGLE_STAFF_OU_PATH;
  process.env.GOOGLE_STUDENT_OU_ROOT = '/Students';
});

afterEach(() => {
  if (savedStaffOuPath === undefined) {
    delete process.env.GOOGLE_STAFF_OU_PATH;
  } else {
    process.env.GOOGLE_STAFF_OU_PATH = savedStaffOuPath;
  }
  if (savedStudentOuRoot === undefined) {
    delete process.env.GOOGLE_STUDENT_OU_ROOT;
  } else {
    process.env.GOOGLE_STUDENT_OU_ROOT = savedStudentOuRoot;
  }
});

// ===========================================================================
// CohortService.upsertByOUPath
// ===========================================================================

describe('CohortService.upsertByOUPath', () => {
  it('creates a new Cohort when none exists for the OU path', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { cohortService } = makeServices(fake);

    const cohort = await cohortService.upsertByOUPath('/Students/Spring2026', 'Spring2026');

    expect(cohort.id).toBeDefined();
    expect(cohort.name).toBe('Spring2026');
    expect(cohort.google_ou_path).toBe('/Students/Spring2026');
  });

  it('records a create_cohort audit event when creating', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { cohortService } = makeServices(fake);

    const cohort = await cohortService.upsertByOUPath('/Students/Spring2026', 'Spring2026');

    const events = await findAuditEvents('create_cohort');
    expect(events).toHaveLength(1);
    expect(events[0].target_entity_id).toBe(String(cohort.id));
  });

  it('returns the existing Cohort unchanged when name matches', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { cohortService } = makeServices(fake);

    // Create once
    const first = await cohortService.upsertByOUPath('/Students/Spring2026', 'Spring2026');
    // Upsert again with same name
    const second = await cohortService.upsertByOUPath('/Students/Spring2026', 'Spring2026');

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('Spring2026');

    // Only one create_cohort event
    const events = await findAuditEvents('create_cohort');
    expect(events).toHaveLength(1);
  });

  it('updates the name when an existing Cohort has a different name', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { cohortService } = makeServices(fake);

    const original = await cohortService.upsertByOUPath('/Students/Spring2026', 'OldName');
    const updated = await cohortService.upsertByOUPath('/Students/Spring2026', 'NewName');

    expect(updated.id).toBe(original.id);
    expect(updated.name).toBe('NewName');
    expect(updated.google_ou_path).toBe('/Students/Spring2026');
  });

  it('records an update_cohort audit event when name changes', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { cohortService } = makeServices(fake);

    await cohortService.upsertByOUPath('/Students/Spring2026', 'OldName');
    await cohortService.upsertByOUPath('/Students/Spring2026', 'NewName');

    const updateEvents = await findAuditEvents('update_cohort');
    expect(updateEvents).toHaveLength(1);
  });

  it('does not call createOU on the Google client', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { cohortService } = makeServices(fake);

    await cohortService.upsertByOUPath('/Students/Spring2026', 'Spring2026');

    expect(fake.calls.createOU).toHaveLength(0);
  });
});

// ===========================================================================
// WorkspaceSyncService.syncCohorts
// ===========================================================================

describe('WorkspaceSyncService.syncCohorts', () => {
  it('creates Cohort rows for new OUs', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedOUs('/Students', [
      { orgUnitPath: '/Students/Spring2026', name: 'Spring2026' },
      { orgUnitPath: '/Students/Fall2026', name: 'Fall2026' },
    ]);
    const { svc } = makeServices(fake);

    const report = await svc.syncCohorts();

    expect(report.cohortsUpserted).toBe(2);
    const spring = await findCohortByOUPath('/Students/Spring2026');
    const fall = await findCohortByOUPath('/Students/Fall2026');
    expect(spring).not.toBeNull();
    expect(spring.name).toBe('Spring2026');
    expect(fall).not.toBeNull();
    expect(fall.name).toBe('Fall2026');
  });

  it('returns cohortsUpserted=0 when OU list is empty', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    // ouSeed has no entry for /Students → returns []
    const { svc } = makeServices(fake);

    const report = await svc.syncCohorts();

    expect(report.cohortsUpserted).toBe(0);
  });

  it('handles existing cohorts (name unchanged)', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedOUs('/Students', [
      { orgUnitPath: '/Students/Spring2026', name: 'Spring2026' },
    ]);
    const { svc } = makeServices(fake);

    await svc.syncCohorts();
    // Run again — existing cohort with matching name
    const report = await svc.syncCohorts();

    expect(report.cohortsUpserted).toBe(1);
    const cohorts = await (prisma as any).cohort.findMany();
    expect(cohorts).toHaveLength(1);
  });

  it('records a sync_cohorts_completed audit event', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { svc } = makeServices(fake);

    await svc.syncCohorts();

    const events = await findAuditEvents('sync_cohorts_completed');
    expect(events).toHaveLength(1);
  });

  it('uses GOOGLE_STUDENT_OU_ROOT env var', async () => {
    process.env.GOOGLE_STUDENT_OU_ROOT = '/CustomRoot';
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedOUs('/CustomRoot', [
      { orgUnitPath: '/CustomRoot/Alpha', name: 'Alpha' },
    ]);
    const { svc } = makeServices(fake);

    const report = await svc.syncCohorts();

    expect(fake.calls.listOUs[0]).toBe('/CustomRoot');
    expect(report.cohortsUpserted).toBe(1);
  });
});

// ===========================================================================
// WorkspaceSyncService.syncStaff
// ===========================================================================

describe('WorkspaceSyncService.syncStaff', () => {
  it('skips and returns staffUpserted=0 when GOOGLE_STAFF_OU_PATH is not set', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { svc } = makeServices(fake);

    const report = await svc.syncStaff();

    expect(report.staffUpserted).toBe(0);
    expect(fake.calls.listUsersInOU).toHaveLength(0);
  });

  it('records sync_staff_completed with skipped=true when env var absent', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { svc } = makeServices(fake);

    await svc.syncStaff();

    const events = await findAuditEvents('sync_staff_completed');
    expect(events).toHaveLength(1);
    expect((events[0].details as any).skipped).toBe(true);
  });

  it('creates new staff users from the staff OU', async () => {
    process.env.GOOGLE_STAFF_OU_PATH = '/Staff';
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedUsers('/Staff', [
      { id: 'gws1', primaryEmail: 'alice@jointheleague.org', orgUnitPath: '/Staff' },
      { id: 'gws2', primaryEmail: 'bob@jointheleague.org', orgUnitPath: '/Staff' },
    ]);
    const { svc } = makeServices(fake);

    const report = await svc.syncStaff();

    expect(report.staffUpserted).toBe(2);
    const alice = await findUserByEmail('alice@jointheleague.org');
    expect(alice).not.toBeNull();
    expect(alice.role).toBe('staff');
    expect(alice.created_via).toBe('workspace_sync');
    const bob = await findUserByEmail('bob@jointheleague.org');
    expect(bob.role).toBe('staff');
  });

  it('updates an existing student user to staff role', async () => {
    process.env.GOOGLE_STAFF_OU_PATH = '/Staff';
    // Pre-create user as student
    await (prisma as any).user.create({
      data: {
        primary_email: 'alice@jointheleague.org',
        display_name: 'Alice',
        role: 'student',
        created_via: 'admin_created',
      },
    });

    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedUsers('/Staff', [
      { id: 'gws1', primaryEmail: 'alice@jointheleague.org', orgUnitPath: '/Staff' },
    ]);
    const { svc } = makeServices(fake);

    await svc.syncStaff();

    const alice = await findUserByEmail('alice@jointheleague.org');
    expect(alice.role).toBe('staff');
  });

  it('does not downgrade an admin user to staff', async () => {
    process.env.GOOGLE_STAFF_OU_PATH = '/Staff';
    await (prisma as any).user.create({
      data: {
        primary_email: 'admin@jointheleague.org',
        display_name: 'Admin',
        role: 'admin',
        created_via: 'admin_created',
      },
    });

    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedUsers('/Staff', [
      { id: 'gws1', primaryEmail: 'admin@jointheleague.org', orgUnitPath: '/Staff' },
    ]);
    const { svc } = makeServices(fake);

    await svc.syncStaff();

    const adminUser = await findUserByEmail('admin@jointheleague.org');
    expect(adminUser.role).toBe('admin');
  });

  it('leaves an existing staff user unchanged', async () => {
    process.env.GOOGLE_STAFF_OU_PATH = '/Staff';
    await (prisma as any).user.create({
      data: {
        primary_email: 'staff@jointheleague.org',
        display_name: 'Staff',
        role: 'staff',
        created_via: 'admin_created',
      },
    });

    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedUsers('/Staff', [
      { id: 'gws1', primaryEmail: 'staff@jointheleague.org', orgUnitPath: '/Staff' },
    ]);
    const { svc } = makeServices(fake);

    await svc.syncStaff();

    const staffUser = await findUserByEmail('staff@jointheleague.org');
    expect(staffUser.role).toBe('staff');
  });

  it('records sync_staff_completed audit event with count', async () => {
    process.env.GOOGLE_STAFF_OU_PATH = '/Staff';
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedUsers('/Staff', [
      { id: 'gws1', primaryEmail: 'alice@jointheleague.org', orgUnitPath: '/Staff' },
    ]);
    const { svc } = makeServices(fake);

    await svc.syncStaff();

    const events = await findAuditEvents('sync_staff_completed');
    expect(events).toHaveLength(1);
    expect((events[0].details as any).staff_upserted).toBe(1);
  });
});

// ===========================================================================
// WorkspaceSyncService.syncStudents
// ===========================================================================

describe('WorkspaceSyncService.syncStudents', () => {
  it('creates root OU users with role=student and cohort_id=null', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedUsers('/Students', [
      { id: 'u1', primaryEmail: 'student1@students.jointheleague.org', orgUnitPath: '/Students' },
    ]);
    const { svc } = makeServices(fake);

    const report = await svc.syncStudents();

    expect(report.studentsUpserted).toBe(1);
    const user = await findUserByEmail('student1@students.jointheleague.org');
    expect(user).not.toBeNull();
    expect(user.role).toBe('student');
    expect(user.cohort_id).toBeNull();
    expect(user.created_via).toBe('workspace_sync');
  });

  it('assigns cohort_id to users in a cohort OU', async () => {
    // Create a cohort with a google_ou_path
    const cohort = await (prisma as any).cohort.create({
      data: { name: 'Spring2026', google_ou_path: '/Students/Spring2026' },
    });

    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedUsers('/Students', []); // no root students
    fake.seedUsers('/Students/Spring2026', [
      { id: 'u2', primaryEmail: 'cohort.student@students.jointheleague.org', orgUnitPath: '/Students/Spring2026' },
    ]);
    const { svc } = makeServices(fake);

    const report = await svc.syncStudents();

    expect(report.studentsUpserted).toBe(1);
    const user = await findUserByEmail('cohort.student@students.jointheleague.org');
    expect(user.cohort_id).toBe(cohort.id);
    expect(user.role).toBe('student');
  });

  it('preserves admin role — does not set to student', async () => {
    const admin = await (prisma as any).user.create({
      data: {
        primary_email: 'admin@students.jointheleague.org',
        display_name: 'Admin Student',
        role: 'admin',
        created_via: 'admin_created',
      },
    });

    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedUsers('/Students', [
      { id: 'a1', primaryEmail: 'admin@students.jointheleague.org', orgUnitPath: '/Students' },
    ]);
    const { svc } = makeServices(fake);

    await svc.syncStudents();

    const user = await findUserByEmail('admin@students.jointheleague.org');
    expect(user.role).toBe('admin');
  });

  it('updates cohort_id for admin even when preserving role', async () => {
    const cohort = await (prisma as any).cohort.create({
      data: { name: 'Spring2026', google_ou_path: '/Students/Spring2026' },
    });
    await (prisma as any).user.create({
      data: {
        primary_email: 'admin@students.jointheleague.org',
        display_name: 'Admin',
        role: 'admin',
        created_via: 'admin_created',
        cohort_id: null,
      },
    });

    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedUsers('/Students', []);
    fake.seedUsers('/Students/Spring2026', [
      { id: 'a1', primaryEmail: 'admin@students.jointheleague.org', orgUnitPath: '/Students/Spring2026' },
    ]);
    const { svc } = makeServices(fake);

    await svc.syncStudents();

    const user = await findUserByEmail('admin@students.jointheleague.org');
    expect(user.role).toBe('admin');
    expect(user.cohort_id).toBe(cohort.id);
  });

  it('flags active workspace ExternalAccounts not seen in any OU', async () => {
    // Create a user with an active workspace account
    const user = await (prisma as any).user.create({
      data: {
        primary_email: 'gone@students.jointheleague.org',
        display_name: 'Gone',
        role: 'student',
        created_via: 'workspace_sync',
      },
    });
    const acct = await createWorkspaceAccount(user.id, 'active');

    const fake = new FakeGoogleWorkspaceAdminClient();
    // seed returns empty — this user's email is not seen
    const { svc } = makeServices(fake);

    const report = await svc.syncStudents();

    expect(report.flaggedAccounts).toContain('gone@students.jointheleague.org');

    // Account should now be status=removed
    const updated = await (prisma as any).externalAccount.findUnique({ where: { id: acct.id } });
    expect(updated.status).toBe('removed');
  });

  it('flags pending workspace ExternalAccounts not seen in any OU', async () => {
    const user = await (prisma as any).user.create({
      data: {
        primary_email: 'pending@students.jointheleague.org',
        display_name: 'Pending',
        role: 'student',
        created_via: 'workspace_sync',
      },
    });
    const acct = await createWorkspaceAccount(user.id, 'pending');

    const fake = new FakeGoogleWorkspaceAdminClient();
    const { svc } = makeServices(fake);

    const report = await svc.syncStudents();

    expect(report.flaggedAccounts).toContain('pending@students.jointheleague.org');
    const updated = await (prisma as any).externalAccount.findUnique({ where: { id: acct.id } });
    expect(updated.status).toBe('removed');
  });

  it('does not flag workspace accounts whose email IS seen', async () => {
    const user = await (prisma as any).user.create({
      data: {
        primary_email: 'present@students.jointheleague.org',
        display_name: 'Present',
        role: 'student',
        created_via: 'workspace_sync',
      },
    });
    const acct = await createWorkspaceAccount(user.id, 'active');

    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedUsers('/Students', [
      { id: 'u1', primaryEmail: 'present@students.jointheleague.org', orgUnitPath: '/Students' },
    ]);
    const { svc } = makeServices(fake);

    const report = await svc.syncStudents();

    expect(report.flaggedAccounts).not.toContain('present@students.jointheleague.org');
    const unchanged = await (prisma as any).externalAccount.findUnique({ where: { id: acct.id } });
    expect(unchanged.status).toBe('active');
  });

  it('records workspace_sync_flagged audit event for each flagged account', async () => {
    const user = await (prisma as any).user.create({
      data: {
        primary_email: 'flagged@students.jointheleague.org',
        display_name: 'Flagged',
        role: 'student',
        created_via: 'workspace_sync',
      },
    });
    await createWorkspaceAccount(user.id, 'active');

    const fake = new FakeGoogleWorkspaceAdminClient();
    const { svc } = makeServices(fake);

    await svc.syncStudents();

    const events = await findAuditEvents('workspace_sync_flagged');
    expect(events).toHaveLength(1);
    expect((events[0].details as any).league_email).toBe('flagged@students.jointheleague.org');
  });

  it('records sync_students_completed audit event', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { svc } = makeServices(fake);

    await svc.syncStudents();

    const events = await findAuditEvents('sync_students_completed');
    expect(events).toHaveLength(1);
  });

  it('returns empty flaggedAccounts when no accounts are flagged', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { svc } = makeServices(fake);

    const report = await svc.syncStudents();

    expect(report.flaggedAccounts).toEqual([]);
  });
});

// ===========================================================================
// WorkspaceSyncService.syncAll
// ===========================================================================

describe('WorkspaceSyncService.syncAll', () => {
  it('runs all three operations and returns combined report', async () => {
    process.env.GOOGLE_STAFF_OU_PATH = '/Staff';
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.seedOUs('/Students', [
      { orgUnitPath: '/Students/Spring2026', name: 'Spring2026' },
    ]);
    fake.seedUsers('/Staff', [
      { id: 'gws1', primaryEmail: 'alice@jointheleague.org', orgUnitPath: '/Staff' },
    ]);
    fake.seedUsers('/Students', [
      { id: 'u1', primaryEmail: 'student@students.jointheleague.org', orgUnitPath: '/Students' },
    ]);
    const { svc } = makeServices(fake);

    const report = await svc.syncAll();

    expect(report.cohortsUpserted).toBe(1);
    expect(report.staffUpserted).toBe(1);
    expect(report.studentsUpserted).toBeGreaterThanOrEqual(1);
    expect(report.errors).toHaveLength(0);
  });

  it('records sync_all_completed audit event', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    const { svc } = makeServices(fake);

    await svc.syncAll();

    const events = await findAuditEvents('sync_all_completed');
    expect(events).toHaveLength(1);
  });

  it('continues past syncCohorts failure and still runs syncStaff and syncStudents', async () => {
    process.env.GOOGLE_STAFF_OU_PATH = '/Staff';
    const fake = new FakeGoogleWorkspaceAdminClient();
    // Make listOUs fail (used by syncCohorts)
    fake.configureError('listOUs', new WorkspaceApiError('listOUs failed', 'listOUs', 500));
    fake.seedUsers('/Staff', [
      { id: 'gws1', primaryEmail: 'alice@jointheleague.org', orgUnitPath: '/Staff' },
    ]);
    const { svc } = makeServices(fake);

    const report = await svc.syncAll();

    // syncCohorts failed
    expect(report.errors).toHaveLength(1);
    expect(report.errors![0].operation).toBe('syncCohorts');

    // syncStaff and syncStudents still ran
    expect(report.staffUpserted).toBe(1);
    expect(report.studentsUpserted).toBe(0);

    const alice = await findUserByEmail('alice@jointheleague.org');
    expect(alice).not.toBeNull();
    expect(alice.role).toBe('staff');
  });

  it('records error details in sync_all_completed audit event', async () => {
    const fake = new FakeGoogleWorkspaceAdminClient();
    fake.configureError('listOUs', new WorkspaceApiError('boom', 'listOUs', 503));
    const { svc } = makeServices(fake);

    await svc.syncAll();

    const events = await findAuditEvents('sync_all_completed');
    expect(events).toHaveLength(1);
    expect((events[0].details as any).error_count).toBe(1);
  });
});
