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
  readonly scheduler: SchedulerService;
  readonly backups: BackupService;
  readonly sessions: SessionService;

  private constructor(source: ServiceSource = 'UI') {
    this.source = source;
    this.audit = new AuditService();
    this.users = new UserService(defaultPrisma, this.audit);
    this.cohorts = new CohortService(defaultPrisma, this.audit);
    this.logins = new LoginService(defaultPrisma, this.audit);
    this.externalAccounts = new ExternalAccountService(defaultPrisma, this.audit);
    this.provisioningRequests = new ProvisioningRequestService(defaultPrisma, this.audit, this.externalAccounts);
    this.mergeSuggestions = new MergeSuggestionService(defaultPrisma);
    this.scheduler = new SchedulerService(defaultPrisma);
    this.backups = new BackupService(defaultPrisma);
    this.sessions = new SessionService(defaultPrisma);
  }

  static create(source?: ServiceSource): ServiceRegistry {
    return new ServiceRegistry(source);
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
