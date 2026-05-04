/**
 * WorkspaceProvisioningService — executes League Workspace account creation.
 *
 * This service is the sole entry point for UC-005: it validates preconditions,
 * calls the Google Workspace Admin SDK to create the user, persists the
 * ExternalAccount row, calls the Pike13 write-back stub, sends a welcome email,
 * and emits the audit event. All database writes occur inside the
 * caller-supplied transaction.
 *
 * The caller owns the transaction boundary. This service does NOT open its
 * own prisma.$transaction.
 *
 * Dependency injection:
 *  - googleClient       — GoogleWorkspaceAdminClient (real or fake)
 *  - externalAccountRepo — ExternalAccountRepository (writes inside tx)
 *  - auditService       — AuditService
 *  - userRepo           — UserRepository (reads inside tx)
 *  - mailService        — MailService (sends welcome email after provisioning)
 *
 * Environment variables consumed:
 *  - GOOGLE_STUDENT_DOMAIN        — required; appended to the email slug.
 *  - GOOGLE_WORKSPACE_TEMP_PASSWORD — required; set as initial password.
 *
 * Errors thrown:
 *  - UnprocessableError (422) — precondition failures (not a student,
 *    missing GOOGLE_WORKSPACE_TEMP_PASSWORD, missing GOOGLE_STUDENT_DOMAIN).
 *  - ConflictError (409) — an active or pending workspace ExternalAccount
 *    already exists for the user.
 *  - WorkspaceApiError / WorkspaceDomainGuardError / WorkspaceWriteDisabledError
 *    — propagated from GoogleWorkspaceAdminClient as-is.
 */

import { createLogger } from './logger.js';

import { ConflictError, UnprocessableError } from '../errors.js';
import type { AuditService } from './audit.service.js';
import type { GoogleWorkspaceAdminClient } from './google-workspace/google-workspace-admin.client.js';
import { ExternalAccountRepository } from './repositories/external-account.repository.js';
import { UserRepository } from './repositories/user.repository.js';
import { displayNameToSlug, splitDisplayName } from '../utils/email-slug.js';
import * as pike13Writeback from './pike13/pike13-writeback.service.js';
import type { ExternalAccount, Prisma } from '../generated/prisma/client.js';
import type { MailService } from './mail.service.js';

const logger = createLogger('workspace-provisioning');

export class WorkspaceProvisioningService {
  constructor(
    private readonly googleClient: GoogleWorkspaceAdminClient,
    private readonly externalAccountRepo: typeof ExternalAccountRepository,
    private readonly auditService: AuditService,
    private readonly userRepo: typeof UserRepository,
    private readonly mailService: MailService,
  ) {}

  /**
   * Provision a League Workspace account for the given user.
   *
   * All database writes are performed inside the provided transaction client.
   * The caller is responsible for opening and committing (or rolling back) the
   * transaction. If the Google Admin SDK call fails, no ExternalAccount row is
   * written — the caller's transaction will roll back naturally if desired.
   *
   * @param userId  - The student whose Workspace account is being created.
   * @param actorId - The admin performing the provisioning action.
   * @param tx      - The caller's Prisma transaction client.
   * @returns The newly created ExternalAccount row.
   *
   * @throws UnprocessableError if the user is not a student, or if required
   *         environment variables (GOOGLE_STUDENT_DOMAIN,
   *         GOOGLE_WORKSPACE_TEMP_PASSWORD) are absent.
   * @throws ConflictError if an active or pending workspace ExternalAccount
   *         already exists for the user.
   * @throws WorkspaceApiError | WorkspaceDomainGuardError |
   *         WorkspaceWriteDisabledError propagated from the Google client.
   */
  async provision(
    userId: number,
    actorId: number,
    tx: Prisma.TransactionClient,
  ): Promise<ExternalAccount> {
    // --- 1. Fetch user ---
    const user = await this.userRepo.findById(tx, userId);
    if (!user) {
      throw new UnprocessableError(`User ${userId} not found`);
    }

    // --- 2. Validate role ---
    if (user.role !== 'student') {
      throw new UnprocessableError(
        `User ${userId} must have role=student to receive a Workspace account (current role: ${user.role})`,
      );
    }

    // --- 3. Check for existing active/pending workspace account ---
    const existing = await this.externalAccountRepo.findActiveByUserAndType(tx, userId, 'workspace');
    if (existing) {
      throw new ConflictError(
        `User ${userId} already has an active or pending workspace ExternalAccount (id=${existing.id})`,
      );
    }

    // --- 3b. If the user previously had a League account that was later
    //         suspended/removed, reactivate it instead of trying to create
    //         a fresh Google user with the same primary email.
    const prior = await (tx as any).externalAccount.findFirst({
      where: {
        user_id: userId,
        type: 'workspace',
        status: { in: ['suspended', 'removed'] },
      },
      orderBy: { status_changed_at: 'desc' },
    });
    if (prior?.external_id) {
      const priorEmail: string = prior.external_id;
      logger.info(
        { userId, actorId, workspaceEmail: priorEmail, externalAccountId: prior.id },
        '[workspace-provisioning] Prior suspended/removed workspace found — reactivating.',
      );

      await this.googleClient.unsuspendUser(priorEmail);

      const reactivated = await this.externalAccountRepo.updateStatus(
        tx,
        prior.id,
        'active',
      );

      await this.auditService.record(tx, {
        actor_user_id: actorId,
        action: 'reactivate_workspace',
        target_user_id: userId,
        target_entity_type: 'ExternalAccount',
        target_entity_id: String(prior.id),
        details: {
          email: priorEmail,
          previous_status: prior.status,
        },
      });

      return reactivated;
    }

    // --- 4. Derive workspace email ---
    const studentDomain = process.env.GOOGLE_STUDENT_DOMAIN;
    if (!studentDomain) {
      throw new UnprocessableError(
        'GOOGLE_STUDENT_DOMAIN environment variable is not set. Cannot derive workspace email.',
      );
    }

    // --- 4b. Resolve temp password (required) ---
    const tempPassword = process.env.GOOGLE_WORKSPACE_TEMP_PASSWORD;
    if (!tempPassword) {
      throw new UnprocessableError(
        'GOOGLE_WORKSPACE_TEMP_PASSWORD is not set. Cannot provision Workspace account.',
      );
    }

    const slug = displayNameToSlug(user.display_name, user.id);
    const workspaceEmail = `${slug}@${studentDomain}`;

    const { givenName, familyName } = splitDisplayName(user.display_name);

    logger.info(
      { userId, actorId, workspaceEmail, orgUnitPath: '/Students' },
      '[workspace-provisioning] Calling GoogleWorkspaceAdminClient.createUser',
    );

    // --- 5. Call Google Admin SDK (may throw; caller's tx rolls back) ---
    //
    // Pass the student's own primary_email as recoveryEmail so Google's
    // welcome/password email lands in an inbox they can actually read.
    // (They can't read the League inbox yet — it's the account being
    // created.) We skip this when primary_email is itself a League
    // address, which would just loop back.
    const leagueDomainRx = /@([a-z0-9-]+\.)?jointheleague\.org$/i;
    const recoveryEmail =
      user.primary_email && !leagueDomainRx.test(user.primary_email)
        ? user.primary_email
        : null;

    const createdUser = await this.googleClient.createUser({
      primaryEmail: workspaceEmail,
      orgUnitPath: '/Students',
      givenName,
      familyName,
      password: tempPassword,
      changePasswordAtNextLogin: true,
      sendNotificationEmail: true,
      recoveryEmail,
    });

    logger.info(
      { userId, googleUserId: createdUser.id, primaryEmail: createdUser.primaryEmail },
      '[workspace-provisioning] Google Workspace user created successfully',
    );

    // --- 6. Persist ExternalAccount inside the caller's transaction ---
    //
    // By convention, `external_id` on workspace rows is the user's League
    // email — not the Google numeric user ID. The delete job, lifecycle
    // service, and claude-provisioning all read it as an email.
    const newAccount = await this.externalAccountRepo.create(tx, {
      user_id: userId,
      type: 'workspace',
      status: 'active',
      external_id: createdUser.primaryEmail,
      status_changed_at: new Date(),
    });

    // --- 7. Call Pike13 write-back (updates League email field in Pike13) ---
    await pike13Writeback.leagueEmail(userId, workspaceEmail);

    // --- 8. Record audit event inside the caller's transaction ---
    await this.auditService.record(tx, {
      actor_user_id: actorId,
      action: 'provision_workspace',
      target_user_id: userId,
      target_entity_type: 'ExternalAccount',
      target_entity_id: String(newAccount.id),
      details: {
        email: workspaceEmail,
        googleUserId: createdUser.id,
        ouPath: '/Students',
      },
    });

    // --- 9. Send welcome email (fail-soft) ---
    const notifEmail = (user as any).notification_email ?? user.primary_email;
    if (notifEmail) {
      try {
        await this.mailService.send({
          to: notifEmail,
          subject: 'Welcome to League Accounts',
          text:
            `Hi ${user.display_name ?? 'there'},\n\n` +
            `Your League account has been created.\n` +
            `League email: ${workspaceEmail}\n` +
            `Temporary password: ${tempPassword}\n\n` +
            `You will be prompted to set your own password on first sign-in.`,
        });
        logger.info(
          { userId, notifEmail },
          '[workspace-provisioning] Welcome email sent successfully',
        );
      } catch (err) {
        logger.warn({ userId, err }, '[workspace-provisioning] welcome email failed — continuing');
      }
    }

    logger.info(
      { userId, actorId, externalAccountId: newAccount.id, workspaceEmail },
      '[workspace-provisioning] Workspace provisioning complete',
    );

    return newAccount;
  }
}
