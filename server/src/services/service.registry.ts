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
import { MergeSuggestionService } from './merge-suggestion.service';
import { WorkspaceProvisioningService } from './workspace-provisioning.service';
import { ClaudeProvisioningService } from './claude-provisioning.service';
import { ExternalAccountLifecycleService } from './external-account-lifecycle.service';
import { WorkspaceSyncService } from './workspace-sync.service';
import { GroupService } from './group.service';
import { BulkGroupService } from './bulk-group.service';
import { LlmProxyTokenService } from './llm-proxy-token.service';
import { LlmProxyForwarderService } from './llm-proxy-forwarder.service';
import { BulkLlmProxyService } from './bulk-llm-proxy.service';
import { PassphraseService } from './passphrase.service';
import { AnthropicSyncService } from './anthropic/anthropic-sync.service';
import { OAuthClientService } from './oauth/oauth-client.service';
import { OAuthTokenService } from './oauth/oauth-token.service';
import { ExternalAccountRepository } from './repositories/external-account.repository';
import { UserRepository } from './repositories/user.repository';
import { CohortRepository } from './repositories/cohort.repository';
import {
  GoogleWorkspaceAdminClientImpl,
  type GoogleWorkspaceAdminClient,
} from './google-workspace/google-workspace-admin.client';
import {
  AnthropicAdminClientImpl,
  resolveAnthropicAdminApiKey,
  type AnthropicAdminClient,
} from './anthropic/anthropic-admin.client';
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
  readonly mergeSuggestions: MergeSuggestionService;
  readonly workspaceProvisioning: WorkspaceProvisioningService;
  readonly claudeProvisioning: ClaudeProvisioningService;
  readonly externalAccountLifecycle: ExternalAccountLifecycleService;
  readonly scheduler: SchedulerService;
  readonly backups: BackupService;
  readonly sessions: SessionService;
  /** Exposed so index.ts can wire the Google Workspace client into background jobs. */
  readonly googleClient: GoogleWorkspaceAdminClient;
  /** Anthropic Admin API client (Sprint 010 T008). Primary Anthropic/Claude org management client. */
  readonly anthropicAdmin: AnthropicAdminClient;
  /** Exposed so route handlers can call pike13Client.getPerson(...) directly. */
  readonly pike13Client: Pike13ApiClient;
  readonly pike13Sync: Pike13SyncService;
  readonly workspaceSync: WorkspaceSyncService;
  readonly anthropicSync: AnthropicSyncService;
  /** App-level Group service (Sprint 012). */
  readonly groups: GroupService;
  /** Bulk provisioning / lifecycle operations scoped to a Group (Sprint 012). */
  readonly bulkGroup: BulkGroupService;
  /** Per-user LLM proxy tokens (Sprint 013). */
  readonly llmProxyTokens: LlmProxyTokenService;
  /** Anthropic Messages forwarder used by the /proxy/v1/* routes (Sprint 013). */
  readonly llmProxyForwarder: LlmProxyForwarderService;
  /** Bulk grant/revoke of LLM proxy access scoped to a cohort or group (Sprint 013). */
  readonly bulkLlmProxy: BulkLlmProxyService;
  /** Signup passphrase lifecycle for Group and Cohort scopes (Sprint 015). */
  readonly passphrases: PassphraseService;
  /** OAuth client registry — create, rotate, disable OAuth applications (Sprint 018). */
  readonly oauthClients: OAuthClientService;
  /** OAuth access token issuance and validation (Sprint 018). */
  readonly oauthTokens: OAuthTokenService;

  private constructor(
    source: ServiceSource = 'UI',
    googleClient?: GoogleWorkspaceAdminClient,
    anthropicAdminClient?: AnthropicAdminClient,
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
        process.env.GOOGLE_CRED_FILE ?? '',
      );

    // CohortService receives the Google client so createWithOU can call createOU.
    this.cohorts = new CohortService(defaultPrisma, this.audit, wsClient);

    this.workspaceProvisioning = new WorkspaceProvisioningService(
      wsClient,
      ExternalAccountRepository,
      this.audit,
      UserRepository,
      CohortRepository,
    );

    // Build an Anthropic Admin client if not provided. Prefers
    // ANTHROPIC_ADMIN_API_KEY; falls back to CLAUDE_TEAM_API_KEY. Errors are
    // deferred to the first method call (fail-secure RD-001).
    this.anthropicAdmin =
      anthropicAdminClient ??
      new AnthropicAdminClientImpl(resolveAnthropicAdminApiKey());

    // ClaudeProvisioningService — Sprint 005 T004 / Sprint 010 T008.
    // Wired to anthropicAdmin (AnthropicAdminClientImpl) rather than the legacy
    // ClaudeTeamAdminClient. The service type was updated to AnthropicAdminClient.
    this.claudeProvisioning = new ClaudeProvisioningService(
      this.anthropicAdmin,
      ExternalAccountRepository,
      this.audit,
      UserRepository,
    );

    // ExternalAccountLifecycleService — Sprint 005 T005 / Sprint 010 T008.
    this.externalAccountLifecycle = new ExternalAccountLifecycleService(
      wsClient,
      this.anthropicAdmin,
      ExternalAccountRepository,
      this.audit,
    );

    this.llmProxyTokens = new LlmProxyTokenService(defaultPrisma, this.audit);

    this.scheduler = new SchedulerService(defaultPrisma);
    this.backups = new BackupService(defaultPrisma);
    this.sessions = new SessionService(defaultPrisma);
    this.googleClient = wsClient;

    // Pike13SyncService — Sprint 006 T003.
    this.pike13Client = new Pike13ApiClientImpl({
      accessToken: process.env.PIKE13_ACCESS_TOKEN,
      clientId: process.env.PIKE13_CLIENT_ID,
      clientSecret: process.env.PIKE13_CLIENT_SECRET,
      apiUrl: resolvePike13ApiUrl(),
    });
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

    // AnthropicSyncService — Sprint 010 T011.
    this.anthropicSync = new AnthropicSyncService(
      this.anthropicAdmin,
      defaultPrisma,
      this.audit,
    );

    // GroupService — Sprint 012 T002.
    this.groups = new GroupService(defaultPrisma, this.audit);

    // BulkGroupService — Sprint 012 T003.
    this.bulkGroup = new BulkGroupService(
      defaultPrisma,
      this.externalAccountLifecycle,
      this.workspaceProvisioning,
      this.claudeProvisioning,
    );

    // LlmProxyForwarderService — Sprint 013 T003.
    this.llmProxyForwarder = new LlmProxyForwarderService();

    // BulkLlmProxyService — Sprint 013 T007.
    this.bulkLlmProxy = new BulkLlmProxyService(
      defaultPrisma,
      this.llmProxyTokens,
    );

    // PassphraseService — Sprint 015 T003.
    this.passphrases = new PassphraseService(defaultPrisma, this.audit);

    // OAuthClientService — Sprint 018.
    this.oauthClients = new OAuthClientService(defaultPrisma, this.audit);

    // OAuthTokenService — Sprint 018.
    this.oauthTokens = new OAuthTokenService(defaultPrisma, this.audit);
  }

  static create(
    source?: ServiceSource,
    googleClient?: GoogleWorkspaceAdminClient,
    anthropicAdminClient?: AnthropicAdminClient,
  ): ServiceRegistry {
    return new ServiceRegistry(source, googleClient, anthropicAdminClient);
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
    // UserGroup has FK → User + Group (Cascade). Explicit delete keeps
    // teardown symmetry with other deleteMany calls.
    await (p as any).userGroup.deleteMany();
    // Sprint 019: authorization codes, refresh tokens, consents cascade from
    // OAuthClient and User — delete before OAuthClient and User.
    await (p as any).oAuthAuthorizationCode.deleteMany();
    await (p as any).oAuthRefreshToken.deleteMany();
    await (p as any).oAuthConsent.deleteMany();
    // OAuthAccessToken has FK → OAuthClient (Cascade). Delete before OAuthClient.
    await (p as any).oAuthAccessToken.deleteMany();
    // OAuthClient has FK → User (SetNull). Delete before User.
    await (p as any).oAuthClient.deleteMany();
    // LlmProxyToken has FK → User (Cascade) + granter User? (SetNull).
    // Delete before User for the same teardown-symmetry reason.
    await (p as any).llmProxyToken.deleteMany();
    // Login and ExternalAccount have FK → User with onDelete: Restrict,
    // so they must be deleted before User.
    await p.login.deleteMany();
    await p.externalAccount.deleteMany();
    await p.user.deleteMany();
    await p.cohort.deleteMany();
    await (p as any).group.deleteMany();
  }
}
