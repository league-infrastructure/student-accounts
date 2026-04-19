---
id: "004"
title: "WorkspaceProvisioningService — provision with precondition checks, ExternalAccount creation, and audit"
status: todo
use-cases: [UC-005]
depends-on: ["001", "002", "003"]
github-issue: ""
todo: ""
---

# WorkspaceProvisioningService — provision with precondition checks, ExternalAccount creation, and audit

## Description

This ticket implements the core of UC-005: the service that takes a userId
and actually creates the League Workspace account. It is a new service module
(`WorkspaceProvisioningService`) distinct from `ExternalAccountService` and
`ProvisioningRequestService`.

The service:
1. Validates preconditions (role=student, cohort with OU, no active workspace account).
2. Calls `GoogleWorkspaceAdminClient.createUser`.
3. Creates an `ExternalAccount` row (type=workspace, status=active,
   external_id=Google user ID) using the repository directly inside the
   caller-supplied transaction.
4. Calls `pike13WritebackStub.leagueEmail` (no-op this sprint).
5. Records the `provision_workspace` audit event.

The caller owns the transaction boundary. This service does not open its own
`prisma.$transaction` — it writes inside the `tx` passed to it.

## Acceptance Criteria

- [ ] `server/src/services/workspace-provisioning.service.ts` is created.
- [ ] Class `WorkspaceProvisioningService` is exported.
- [ ] Constructor accepts:
      - `googleClient: GoogleWorkspaceAdminClient`
      - `externalAccountRepo: ExternalAccountRepository`
      - `auditService: AuditService`
      - `userRepo: UserRepository`
      - `cohortRepo: CohortRepository`
- [ ] Method `provision(userId: number, actorId: number, tx: Prisma.TransactionClient): Promise<ExternalAccount>`:
      - Fetches the User by `userId` using `userRepo.findById(tx, userId)`.
      - Validates `user.role === 'student'`. If not, throws `UnprocessableError`.
      - Validates `user.cohort_id` is set and the Cohort has a non-null
        `google_ou_path`. If not, throws `UnprocessableError` with a message
        directing the admin to assign a cohort first.
      - Checks `externalAccountRepo` for an existing type=workspace account
        with status IN ('pending', 'active'). If found, throws `ConflictError`.
      - Derives the workspace email: slugifies `user.display_name` (lowercase,
        spaces to dots, strip non-alphanumeric except dots and hyphens) and
        appends `@${GOOGLE_STUDENT_DOMAIN}`. Truncates slug to reasonable length
        to avoid email-length limits.
      - Calls `googleClient.createUser({
          primaryEmail: workspaceEmail,
          orgUnitPath: cohort.google_ou_path,
          givenName, familyName (split from display_name),
          sendNotificationEmail: true
        })`.
      - On SDK success: calls `externalAccountRepo.create(tx, {
          user_id: userId,
          type: 'workspace',
          status: 'active',
          external_id: createdUser.id,
          status_changed_at: new Date()
        })`.
      - Calls `pike13WritebackStub.leagueEmail(userId, workspaceEmail)`.
      - Calls `auditService.record(tx, {
          actor_user_id: actorId,
          action: 'provision_workspace',
          target_user_id: userId,
          target_entity_type: 'ExternalAccount',
          target_entity_id: String(newAccount.id),
          details: { email: workspaceEmail, googleUserId: createdUser.id }
        })`.
      - Returns the created `ExternalAccount`.
- [ ] SDK failure (`WorkspaceApiError`) propagates to the caller; no
      ExternalAccount row is created (transaction rolled back by caller).
- [ ] Guard errors (`WorkspaceDomainGuardError`, `WorkspaceWriteDisabledError`)
      propagate to the caller.
- [ ] `WorkspaceProvisioningService` is registered in `ServiceRegistry` and
      receives its dependencies via constructor injection.
- [ ] `npm test` passes.

## Implementation Plan

### Approach

New service module. Constructor-injected dependencies (same pattern as
`ProvisioningRequestService` having `ExternalAccountService` injected in
Sprint 003). Reads `GOOGLE_STUDENT_DOMAIN` from `process.env`.

For the email slug: a simple utility function is sufficient. Edge cases to
handle: display names with unicode characters (normalize to ASCII or strip);
names that produce a slug shorter than 3 characters (fall back to user ID).
The slug must produce a valid email local part (RFC 5321).

### Files to Create

- `server/src/services/workspace-provisioning.service.ts`
- `server/src/utils/email-slug.ts` — utility for display-name-to-email-slug

### Files to Modify

- `server/src/services/service.registry.ts` — register `WorkspaceProvisioningService`
  with its dependencies.

### Testing Plan

Integration tests for `WorkspaceProvisioningService` are in T010 (cross-cutting
UC-005 test). This ticket should include unit tests for the email slug utility:
- Standard name → expected slug
- Name with spaces → dots
- Name with special characters → stripped
- Very long name → truncated to length limit
- Display name that is a single word → no dot
- Edge: display name that produces empty slug → fallback to user ID

### Documentation Updates

None. Architecture doc is updated above. ServiceRegistry change is self-evident.
