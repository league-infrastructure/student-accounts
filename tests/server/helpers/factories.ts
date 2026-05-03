/**
 * Factory helpers for all seven domain entities.
 *
 * Factories insert rows directly via the Prisma client so they remain
 * independent of service-layer invariants. Each factory accepts optional
 * overrides to customise any field.
 *
 * Returned values are fully typed Prisma model objects with all fields.
 */
import { prisma } from '../../../server/src/services/prisma.js';
import type {
  Cohort,
  User,
  Login,
  ExternalAccount,
  AuditEvent,
  ProvisioningRequest,
  MergeSuggestion,
  Group,
} from '../../../server/src/generated/prisma/models.js';

// ---------------------------------------------------------------------------
// Counter used to ensure unique email addresses across parallel tests within
// a single run. Uses a simple module-level increment.
// ---------------------------------------------------------------------------

let _seq = 0;
function seq(): number {
  return ++_seq;
}

// ---------------------------------------------------------------------------
// Cohort
// ---------------------------------------------------------------------------

export async function makeCohort(
  overrides: Partial<{ name: string; google_ou_path: string | null }> = {},
): Promise<Cohort> {
  const n = seq();
  return (prisma as any).cohort.create({
    data: {
      name: `Test Cohort ${n}`,
      google_ou_path: `/Test/Cohort${n}`,
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// User
// ---------------------------------------------------------------------------

export async function makeUser(
  overrides: Partial<{
    display_name: string;
    primary_email: string;
    role: 'student' | 'staff' | 'admin';
    created_via: 'social_login' | 'pike13_sync' | 'admin_created';
    cohort_id: number | null;
  }> = {},
): Promise<User> {
  const n = seq();
  return (prisma as any).user.create({
    data: {
      display_name: `Test User ${n}`,
      primary_email: `testuser${n}@example.com`,
      role: 'student',
      created_via: 'admin_created',
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

export async function makeLogin(
  user: User,
  overrides: Partial<{
    provider: string;
    provider_user_id: string;
    provider_email: string | null;
  }> = {},
): Promise<Login> {
  const n = seq();
  return (prisma as any).login.create({
    data: {
      user_id: user.id,
      provider: 'google',
      provider_user_id: `google_uid_${n}`,
      provider_email: `testuser${n}@gmail.com`,
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// ExternalAccount
// ---------------------------------------------------------------------------

export async function makeExternalAccount(
  user: User,
  overrides: Partial<{
    type: 'workspace' | 'claude' | 'pike13';
    external_id: string | null;
    status: 'pending' | 'active' | 'suspended' | 'removed';
    status_changed_at: Date | null;
  }> = {},
): Promise<ExternalAccount> {
  const n = seq();
  return (prisma as any).externalAccount.create({
    data: {
      user_id: user.id,
      type: 'workspace',
      external_id: `ext_${n}`,
      status: 'pending',
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// AuditEvent
// ---------------------------------------------------------------------------

export async function makeAuditEvent(
  overrides: Partial<{
    actor_user_id: number | null;
    action: string;
    target_user_id: number | null;
    target_entity_type: string | null;
    target_entity_id: string | null;
    details: Record<string, unknown> | null;
  }> = {},
): Promise<AuditEvent> {
  return (prisma as any).auditEvent.create({
    data: {
      action: 'create_user',
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// ProvisioningRequest
// ---------------------------------------------------------------------------

export async function makeProvisioningRequest(
  user: User,
  overrides: Partial<{
    requested_type: 'workspace' | 'claude';
    status: 'pending' | 'approved' | 'rejected';
    decided_by: number | null;
    decided_at: Date | null;
  }> = {},
): Promise<ProvisioningRequest> {
  return (prisma as any).provisioningRequest.create({
    data: {
      user_id: user.id,
      requested_type: 'workspace',
      status: 'pending',
      ...overrides,
    },
  });
}

// ---------------------------------------------------------------------------
// Group — Sprint 012
// ---------------------------------------------------------------------------

export async function makeGroup(
  overrides: Partial<{
    name: string;
    description: string | null;
    allows_oauth_client: boolean;
    allows_llm_proxy: boolean;
    allows_league_account: boolean;
  }> = {},
): Promise<Group> {
  const n = seq();
  return (prisma as any).group.create({
    data: {
      name: `Test Group ${n}`,
      description: null,
      ...overrides,
    },
  });
}

export async function makeMembership(
  group: Group,
  user: User,
): Promise<void> {
  await (prisma as any).userGroup.create({
    data: { group_id: group.id, user_id: user.id },
  });
}

// ---------------------------------------------------------------------------
// MergeSuggestion
// ---------------------------------------------------------------------------

export async function makeMergeSuggestion(
  userA: User,
  userB: User,
  overrides: Partial<{
    haiku_confidence: number;
    haiku_rationale: string | null;
    status: 'pending' | 'approved' | 'rejected' | 'deferred';
    decided_by: number | null;
    decided_at: Date | null;
  }> = {},
): Promise<MergeSuggestion> {
  return (prisma as any).mergeSuggestion.create({
    data: {
      user_a_id: userA.id,
      user_b_id: userB.id,
      haiku_confidence: 0.75,
      ...overrides,
    },
  });
}
