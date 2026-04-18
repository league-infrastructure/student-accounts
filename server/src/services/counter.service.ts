export class CounterService {
  private prisma: any;

  constructor(prisma: any) {
    this.prisma = prisma;
  }

  /** Return all counters as `{ name, value }` pairs. */
  async list(): Promise<Array<{ name: string; value: number }>> {
    const rows = await this.prisma.counter.findMany({
      orderBy: { name: 'asc' },
      select: { name: true, value: true },
    });
    return rows;
  }

  /**
   * Increment the named counter by 1 and return the new value.
   * Auto-creates the row with value = 1 if it does not exist (upsert).
   */
  async increment(name: string): Promise<{ name: string; value: number }> {
    // Prisma SQLite does not support atomic increment via update.
    // Use a transaction: find-or-create, then increment.
    const result = await this.prisma.$transaction(async (tx: any) => {
      const existing = await tx.counter.findUnique({ where: { name } });
      if (existing) {
        return tx.counter.update({
          where: { name },
          data: { value: existing.value + 1 },
          select: { name: true, value: true },
        });
      }
      return tx.counter.create({
        data: { name, value: 1 },
        select: { name: true, value: true },
      });
    });
    return result;
  }
}
