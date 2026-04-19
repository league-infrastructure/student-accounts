export class SchedulerService {
  private prisma: any;
  private handlers: Map<string, () => Promise<void>> = new Map();
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  registerHandler(jobName: string, handler: () => Promise<void>) {
    this.handlers.set(jobName, handler);
  }

  calculateNextRun(frequency: string, fromDate: Date = new Date()): Date {
    const next = new Date(fromDate);
    switch (frequency) {
      case 'hourly': next.setHours(next.getHours() + 1); break;
      case 'daily': next.setDate(next.getDate() + 1); break;
      case 'weekly': next.setDate(next.getDate() + 7); break;
      default: next.setDate(next.getDate() + 1); break;
    }
    return next;
  }

  async tick(): Promise<void> {
    const dueJobs = await this.prisma.scheduledJob.findMany({
      where: { enabled: true, nextRun: { lte: new Date() } },
    });

    for (const job of dueJobs as any[]) {
      const handler = this.handlers.get(job.name);
      if (!handler) continue;

      try {
        await handler();
        await this.prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            lastRun: new Date(),
            nextRun: this.calculateNextRun(job.frequency),
            lastError: null,
          },
        });
      } catch (err: any) {
        await this.prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            lastRun: new Date(),
            nextRun: this.calculateNextRun(job.frequency),
            lastError: err.message?.substring(0, 500) || 'Unknown error',
          },
        });
      }
    }
  }

  async runJobNow(id: number): Promise<any> {
    const job = await this.prisma.scheduledJob.findUnique({ where: { id } });
    if (!job) throw new Error('Job not found');

    const handler = this.handlers.get(job.name);
    try {
      if (handler) await handler();
      return await this.prisma.scheduledJob.update({
        where: { id },
        data: {
          lastRun: new Date(),
          nextRun: this.calculateNextRun(job.frequency),
          lastError: null,
        },
      });
    } catch (err: any) {
      return await this.prisma.scheduledJob.update({
        where: { id },
        data: {
          lastRun: new Date(),
          nextRun: this.calculateNextRun(job.frequency),
          lastError: err.message?.substring(0, 500) || 'Unknown error',
        },
      });
    }
  }

  async listJobs(): Promise<any[]> {
    return this.prisma.scheduledJob.findMany({ orderBy: { name: 'asc' } });
  }

  async updateJob(id: number, data: { enabled?: boolean }): Promise<any> {
    return this.prisma.scheduledJob.update({ where: { id }, data });
  }

  startTicking(intervalMs: number = 60000): void {
    if (this.intervalHandle) return;
    this.intervalHandle = setInterval(() => this.tick().catch(() => {}), intervalMs);
  }

  stopTicking(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  async seedDefaults(): Promise<void> {
    const defaults = [
      { name: 'daily-backup', frequency: 'daily' },
      { name: 'weekly-backup', frequency: 'weekly' },
      { name: 'workspace-delete', frequency: 'hourly' },
    ];
    for (const def of defaults) {
      await this.prisma.scheduledJob.upsert({
        where: { name: def.name },
        update: {},
        create: {
          ...def,
          enabled: true,
          nextRun: this.calculateNextRun(def.frequency),
        },
      });
    }
  }
}
