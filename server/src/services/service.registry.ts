import type { ServiceSource } from '../contracts/index';

// Import the lazy-init prisma (the actual PrismaClient proxy)
import { prisma as defaultPrisma } from './prisma';

// Import existing service functions
import { initConfigCache, getConfig, getAllConfig, setConfig, exportConfig } from './config';
import { logBuffer } from './logBuffer';
import { UserService } from './user.service';
import { SchedulerService } from './scheduler.service';
import { BackupService } from './backup.service';
import { SessionService } from './session.service';
import { CounterService } from './counter.service';

export class ServiceRegistry {
  readonly source: ServiceSource;
  readonly users: UserService;
  readonly scheduler: SchedulerService;
  readonly backups: BackupService;
  readonly sessions: SessionService;
  readonly counter: CounterService;

  private constructor(source: ServiceSource = 'UI') {
    this.source = source;
    this.users = new UserService(defaultPrisma);
    this.scheduler = new SchedulerService(defaultPrisma);
    this.backups = new BackupService(defaultPrisma);
    this.sessions = new SessionService(defaultPrisma);
    this.counter = new CounterService(defaultPrisma);
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
    await p.user.deleteMany();
  }
}
