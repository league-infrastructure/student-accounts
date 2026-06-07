/**
 * WorkspaceProvisioningService — executes League Workspace account creation.
 *
 * This service is the sole entry point for UC-005: it validates preconditions,
 * calls the Google Workspace Admin SDK to create the user, persists the
 * ExternalAccount row, calls the Pike13 write-back stub, sends a welcome email,
 * and emits the audit event.
 *
 * Transaction boundary: external API calls (Google, Pike13, mail) happen
 * OUTSIDE any SQLite transaction. Only the final DB writes (ExternalAccount
 * row + audit event) are wrapped in a short internal $transaction. This
 * prevents the SQLite write lock from being held during network I/O, which
 * caused P2028 "Unable to start a transaction in the given time" errors that
 * blocked concurrent sign-ins.
 *
 * Dependency injection:
 *  - googleClient       — GoogleWorkspaceAdminClient (real or fake)
 *  - externalAccountRepo — ExternalAccountRepository
 *  - auditService       — AuditService
 *  - userRepo           — UserRepository
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
import type { ExternalAccount } from '../generated/prisma/client.js';
import type { MailService } from './mail.service.js';
import { prisma as defaultPrisma } from './prisma.js';

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
   * External API calls (Google Admin SDK, Pike13, mail) run BEFORE any
   * database transaction so the SQLite write lock is never held during
   * network I/O. Only the final ExternalAccount + audit writes are wrapped
   * in a short internal $transaction.
   *
   * @param userId  - The student whose Workspace account is being created.
   * @param actorId - The admin performing the provisioning action.
   * @returns The newly created (or reactivated) ExternalAccount row.
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
  ): Promise<ExternalAccount> {
    // --- 1. Pre-flight reads (outside transaction — no lock held) ---
    const user = await this.userRepo.findById(defaultPrisma, userId);
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
    const existing = await this.externalAccountRepo.findActiveByUserAndType(defaultPrisma, userId, 'workspace');
    if (existing) {
      throw new ConflictError(
        `User ${userId} already has an active or pending workspace ExternalAccount (id=${existing.id})`,
      );
    }

    // --- 3b. Check for a prior suspended/removed account to reactivate ---
    const prior = await (defaultPrisma as any).externalAccount.findFirst({
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

      // External call outside transaction
      await this.googleClient.unsuspendUser(priorEmail);

      // Short transaction for DB writes only
      const reactivated = await defaultPrisma.$transaction(async (tx: any) => {
        const result = await this.externalAccountRepo.updateStatus(tx, prior.id, 'active');
        await this.auditService.record(tx, {
          actor_user_id: actorId,
          action: 'reactivate_workspace',
          target_user_id: userId,
          target_entity_type: 'ExternalAccount',
          target_entity_id: String(prior.id),
          details: { email: priorEmail, previous_status: prior.status },
        });
        return result;
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

    // --- 5. External: Google Admin SDK (outside transaction) ---
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

    // --- 6. External: Pike13 write-back (outside transaction) ---
    await pike13Writeback.leagueEmail(userId, workspaceEmail);

    // --- 7. Short transaction for DB writes only ---
    const newAccount = await defaultPrisma.$transaction(async (tx: any) => {
      const account = await this.externalAccountRepo.create(tx, {
        user_id: userId,
        type: 'workspace',
        status: 'active',
        external_id: createdUser.primaryEmail,
        status_changed_at: new Date(),
      });
      await this.auditService.record(tx, {
        actor_user_id: actorId,
        action: 'provision_workspace',
        target_user_id: userId,
        target_entity_type: 'ExternalAccount',
        target_entity_id: String(account.id),
        details: {
          email: workspaceEmail,
          googleUserId: createdUser.id,
          ouPath: '/Students',
        },
      });
      return account;
    });

    // --- 8. Send welcome email (fail-soft, outside transaction) ---
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
