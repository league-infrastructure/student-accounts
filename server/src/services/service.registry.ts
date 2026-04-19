import type { ServiceSource } from '../contracts/index';

// Import the lazy-init prisma (the actual PrismaClient proxy)
import { prisma as defaultPrisma } from './prisma';

// Import existing service functions
import { initConfigCache, getConfig, getAllConfig, setConfig, exportConfig } from './config';
import { logBuffer } from './logBuffer';

// Domain services
import { AuditService } from './audit.service';
import { UserService } from './user.service';
import { CohortService } from './cohort.service';
import { LoginService } from './login.service';
import { ExternalAccountService } from './external-account.service';
import { ProvisioningRequestService } from './provisioning-request.service';
import { MergeSuggestionService } from './merge-suggestion.service';
import { WorkspaceProvisioningService } from './workspace-provisioning.service';
import { ClaudeProvisioningService } from './claude-provisioning.service';
import { ExternalAccountLifecycleService } from './external-account-lifecycle.service';
import { WorkspaceSyncService } from './workspace-sync.service';
import { BulkCohortService } from './bulk-cohort.service';
import { ExternalAccountRepository } from './repositories/external-account.repository';
import { UserRepository } from './repositories/user.repository';
import { CohortRepository } from './repositories/cohort.repository';
import {
  GoogleWorkspaceAdminClientImpl,
  type GoogleWorkspaceAdminClient,
} from './google-workspace/google-workspace-admin.client';
import {
  ClaudeTeamAdminClientImpl,
  type ClaudeTeamAdminClient,
} from './claude-team/claude-team-admin.client';
import {
  Pike13ApiClientImpl,
  resolvePike13ApiUrl,
  type Pike13ApiClient,
} from './pike13/pike13-api.client';
import { Pike13SyncService } from './pike13/pike13-sync.service';
import { mergeScan } from './auth/merge-scan.stub';

// Infrastructure services
import { SchedulerService } from './scheduler.service';
import { BackupService } from './backup.service';
import { SessionService } from './session.service';

export class ServiceRegistry {
  readonly source: ServiceSource;
  readonly audit: AuditService;
  readonly users: UserService;
  readonly cohorts: CohortService;
  readonly logins: LoginService;
  readonly externalAccounts: ExternalAccountService;
  readonly provisioningRequests: ProvisioningRequestService;
  readonly mergeSuggestions: MergeSuggestionService;
  readonly workspaceProvisioning: WorkspaceProvisioningService;
  readonly claudeProvisioning: ClaudeProvisioningService;
  readonly externalAccountLifecycle: ExternalAccountLifecycleService;
  readonly scheduler: SchedulerService;
  readonly backups: BackupService;
  readonly sessions: SessionService;
  /** Exposed so index.ts can wire the Google Workspace client into background jobs. */
  readonly googleClient: GoogleWorkspaceAdminClient;
  /** Exposed so route handlers can call pike13Client.getPerson(...) directly. */
  readonly pike13Client: Pike13ApiClient;
  readonly pike13Sync: Pike13SyncService;
  readonly workspaceSync: WorkspaceSyncService;
  readonly bulkCohort: BulkCohortService;

  private constructor(
    source: ServiceSource = 'UI',
    googleClient?: GoogleWorkspaceAdminClient,
    claudeClient?: ClaudeTeamAdminClient,
  ) {
    this.source = source;
    this.audit = new AuditService();
    this.users = new UserService(defaultPrisma, this.audit);
    this.logins = new LoginService(defaultPrisma, this.audit);
    this.externalAccounts = new ExternalAccountService(defaultPrisma, this.audit);
    this.mergeSuggestions = new MergeSuggestionService(defaultPrisma);

    // Build a Google Workspace Admin client if not provided. The client
    // constructor defers credential errors to first use, so missing env vars
    // do not prevent registry construction (fail-secure RD-001).
    const wsClient: GoogleWorkspaceAdminClient =
      googleClient ??
      new GoogleWorkspaceAdminClientImpl(
        process.env.GOOGLE_SERVICE_ACCOUNT_JSON ?? '',
        process.env.GOOGLE_ADMIN_DELEGATED_USER_EMAIL ?? '',
        process.env.GOOGLE_SERVICE_ACCOUNT_FILE ?? '',
      );

    // CohortService receives the Google client so createWithOU can call createOU.
    this.cohorts = new CohortService(defaultPrisma, this.audit, wsClient);

    // WorkspaceProvisioningService is constructed first so it can be injected
    // into ProvisioningRequestService (Sprint 004 T007: approve() wires provision).
    this.workspaceProvisioning = new WorkspaceProvisioningService(
      wsClient,
      ExternalAccountRepository,
      this.audit,
      UserRepository,
      CohortRepository,
    );

    // Build a Claude Team Admin client if not provided. The client constructor
    // defers credential errors to first use (fail-secure RD-001).
    const ctClient: ClaudeTeamAdminClient =
      claudeClient ??
      new ClaudeTeamAdminClientImpl(
        process.env.CLAUDE_TEAM_API_KEY ?? '',
        process.env.CLAUDE_TEAM_PRODUCT_ID ?? '',
      );

    // ClaudeProvisioningService — Sprint 005 T004.
    this.claudeProvisioning = new ClaudeProvisioningService(
      ctClient,
      ExternalAccountRepository,
      this.audit,
      UserRepository,
    );

    // ExternalAccountLifecycleService — Sprint 005 T005.
    this.externalAccountLifecycle = new ExternalAccountLifecycleService(
      wsClient,
      ctClient,
      ExternalAccountRepository,
      this.audit,
    );

    // Sprint 004 T007: pass workspaceProvisioning so approve() can call provision().
    // Sprint 005 T007: also pass claudeProvisioning so approve() can provision Claude seats.
    this.provisioningRequests = new ProvisioningRequestService(
      defaultPrisma,
      this.audit,
      this.externalAccounts,
      this.workspaceProvisioning,
      this.claudeProvisioning,
    );

    this.scheduler = new SchedulerService(defaultPrisma);
    this.backups = new BackupService(defaultPrisma);
    this.sessions = new SessionService(defaultPrisma);
    this.googleClient = wsClient;

    // Pike13SyncService — Sprint 006 T003.
    this.pike13Client = new Pike13ApiClientImpl(
      process.env.PIKE13_ACCESS_TOKEN ?? '',
      resolvePike13ApiUrl(),
    );
    this.pike13Sync = new Pike13SyncService(
      this.pike13Client,
      defaultPrisma,
      UserRepository,
      ExternalAccountRepository,
      this.audit,
      mergeScan,
    );

    // WorkspaceSyncService — Sprint 006 T006.
    this.workspaceSync = new WorkspaceSyncService(
      defaultPrisma,
      wsClient,
      this.cohorts,
      UserRepository,
      ExternalAccountRepository,
      CohortRepository,
      this.audit,
    );

    // BulkCohortService — Sprint 008 T001.
    this.bulkCohort = new BulkCohortService(
      defaultPrisma,
      this.externalAccountLifecycle,
      UserRepository,
      ExternalAccountRepository,
      CohortRepository,
    );
  }

  static create(
    source?: ServiceSource,
    googleClient?: GoogleWorkspaceAdminClient,
    claudeClient?: ClaudeTeamAdminClient,
  ): ServiceRegistry {
    return new ServiceRegistry(source, googleClient, claudeClient);
  }

  // --- Config ---
  get config() {
    return { initCache: initConfigCache, get: getConfig, getAll: getAllConfig, set: setConfig, export: exportConfig };
  }

  // --- Logs ---
  get logs() {
    return logBuffer;
  }

  // --- Prisma (for direct DB access when needed) ---
  get prisma() {
    return defaultPrisma;
  }

  /**
   * Delete all business data from the database in FK-safe order.
   * Preserves system tables (Config, Session).
   */
  async clearAll(): Promise<void> {
    const p = this.prisma;
    await p.scheduledJob.deleteMany();
    await p.mergeSuggestion.deleteMany();
    await p.provisioningRequest.deleteMany();
    await p.auditEvent.deleteMany();
    // Login and ExternalAccount have FK → User with onDelete: Restrict,
    // so they must be deleted before User.
    await p.login.deleteMany();
    await p.externalAccount.deleteMany();
    await p.user.deleteMany();
    await p.cohort.deleteMany();
  }
}
