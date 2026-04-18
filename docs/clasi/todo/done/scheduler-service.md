---
status: pending
priority: high
source: inventory app (server/src/services/scheduler.service.ts, server/src/middleware/schedulerTick.ts)
---

# Request-Piggybacked Scheduler with Database Tracking

Add a scheduler service that executes periodic jobs (backups, cleanup,
etc.) by piggybacking on incoming HTTP requests rather than using
`setInterval`. Jobs are tracked in the database with row-level locking
to prevent double-execution.

## Why

`setInterval` timers drift, don't survive process restarts, and can
cause duplicate execution in multi-instance deployments. Piggybacking
on HTTP requests means the scheduler only runs when the app is actually
serving traffic, and database-level locks prevent race conditions.

## Schema

```prisma
model ScheduledJob {
  id          Int       @id @default(autoincrement())
  name        String    @unique
  description String?
  frequency   String    // 'daily', 'weekly', 'hourly', etc.
  enabled     Boolean   @default(true)
  lastRunAt   DateTime?
  nextRunAt   DateTime?
  lastError   String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt
}
```

## Scheduler Tick Middleware

Create `server/src/middleware/schedulerTick.ts`:

```typescript
let lastTickTime = 0;
const TICK_INTERVAL = 300_000; // 5 minutes

export function schedulerTick(scheduler: SchedulerService) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    if (now - lastTickTime >= TICK_INTERVAL) {
      lastTickTime = now;
      // Fire and forget — don't block the request
      scheduler.tick().catch(err =>
        console.error('Scheduler tick error:', err)
      );
    }
    next();
  };
}
```

The middleware fires on every incoming request but only actually runs the
tick if enough time has passed. The tick itself is non-blocking.

Can be disabled with `DISABLE_SCHEDULER_TICK=true` for testing or when
running multiple instances behind a load balancer where only one should
schedule.

## SchedulerService

Create `server/src/services/scheduler.service.ts`:

```typescript
export class SchedulerService {
  private handlers = new Map<string, () => Promise<void>>();

  constructor(private prisma: PrismaClient) {}

  /** Register a handler for a named job */
  registerHandler(jobName: string, handler: () => Promise<void>) {
    this.handlers.set(jobName, handler);
  }

  /** Find and execute due jobs with row-level locking */
  async tick(): Promise<void> {
    const now = new Date();

    // Find due jobs using FOR UPDATE SKIP LOCKED to prevent
    // double-execution across instances
    const dueJobs = await this.prisma.$queryRaw`
      SELECT * FROM "ScheduledJob"
      WHERE enabled = true
        AND "nextRunAt" IS NOT NULL
        AND "nextRunAt" <= ${now}
      FOR UPDATE SKIP LOCKED
    `;

    for (const job of dueJobs) {
      const handler = this.handlers.get(job.name);
      if (!handler) continue;

      try {
        await handler();
        await this.prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            lastRunAt: now,
            nextRunAt: this.computeNextRun(job.frequency, now),
            lastError: null,
          },
        });
      } catch (err) {
        await this.prisma.scheduledJob.update({
          where: { id: job.id },
          data: {
            lastRunAt: now,
            nextRunAt: this.computeNextRun(job.frequency, now),
            lastError: String(err),
          },
        });
      }
    }
  }

  /** Run a specific job immediately (manual trigger from admin UI) */
  async runJobNow(jobId: number): Promise<void> {
    const job = await this.prisma.scheduledJob.findUniqueOrThrow({
      where: { id: jobId }
    });
    const handler = this.handlers.get(job.name);
    if (!handler) throw new Error(`No handler for job: ${job.name}`);
    await handler();
    await this.prisma.scheduledJob.update({
      where: { id: jobId },
      data: { lastRunAt: new Date(), lastError: null },
    });
  }

  private computeNextRun(frequency: string, from: Date): Date {
    const next = new Date(from);
    switch (frequency) {
      case 'hourly': next.setHours(next.getHours() + 1); break;
      case 'daily': next.setDate(next.getDate() + 1); break;
      case 'weekly': next.setDate(next.getDate() + 7); break;
      default: next.setDate(next.getDate() + 1);
    }
    return next;
  }
}
```

## Admin Routes

- `GET /api/admin/scheduler/jobs` — list all jobs with status
- `PUT /api/admin/scheduler/jobs/:id` — enable/disable a job
- `POST /api/admin/scheduler/jobs/:id/run` — manual trigger

## Admin UI

Add a Scheduled Jobs panel:

- Table: name, description, frequency, last run, next run, last error,
  enabled toggle
- "Run Now" button per job
- Auto-refresh every 30 seconds

## Default Jobs

Seed on first startup:

- `daily-backup` — frequency: daily, calls `BackupService.createBackup()`
- `weekly-backup` — frequency: weekly, calls `BackupService.createBackup()`

## Reference Files

- Inventory: `server/src/services/scheduler.service.ts`
- Inventory: `server/src/middleware/schedulerTick.ts`
- Inventory: `server/prisma/schema.prisma` — `ScheduledJob` model

## Verification

- Scheduler tick fires after the configured interval on next HTTP request
- Due jobs execute and update lastRunAt/nextRunAt
- Row-level locking prevents double-execution
- Manual "Run Now" works from the admin panel
- Failed jobs record lastError but don't crash the server
- Disabled jobs are skipped
