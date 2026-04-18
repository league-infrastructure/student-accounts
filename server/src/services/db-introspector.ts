interface TableSummary {
  name: string;
  rowCount: number;
}

interface ColumnMeta {
  name: string;
  type: string;
  nullable: boolean;
}

interface TableDetail {
  columns: ColumnMeta[];
  rows: any[];
  total: number;
  page: number;
  limit: number;
}

export interface DbIntrospector {
  listTables(): Promise<TableSummary[]>;
  getTableDetail(name: string, page: number, limit: number): Promise<TableDetail | null>;
}

class SqliteIntrospector implements DbIntrospector {
  constructor(private prisma: any) {}

  async listTables(): Promise<TableSummary[]> {
    const tables = await this.prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE '_prisma%' AND name != 'sqlite_sequence' ORDER BY name`
    ) as { name: string }[];

    return Promise.all(
      tables.map(async (t: { name: string }) => {
        const countResult = await this.prisma.$queryRawUnsafe(
          `SELECT count(*) as count FROM "${t.name}"`
        ) as [{ count: number }];
        return { name: t.name, rowCount: Number(countResult[0].count) };
      })
    );
  }

  async getTableDetail(name: string, page: number, limit: number): Promise<TableDetail | null> {
    const offset = (page - 1) * limit;

    // Validate table exists
    const validTables = await this.prisma.$queryRawUnsafe(
      `SELECT name FROM sqlite_master WHERE type='table' AND name = '${name}'`
    ) as { name: string }[];
    if (validTables.length === 0) return null;

    // Get column metadata via PRAGMA
    const pragmaColumns = await this.prisma.$queryRawUnsafe(
      `PRAGMA table_info("${name}")`
    ) as { name: string; type: string; notnull: number }[];

    const countResult = await this.prisma.$queryRawUnsafe(
      `SELECT count(*) as count FROM "${name}"`
    ) as [{ count: number }];
    const total = Number(countResult[0].count);

    const rows = await this.prisma.$queryRawUnsafe(
      `SELECT * FROM "${name}" ORDER BY 1 LIMIT ${limit} OFFSET ${offset}`
    );

    return {
      columns: pragmaColumns.map((c) => ({
        name: c.name,
        type: c.type || 'TEXT',
        nullable: c.notnull === 0,
      })),
      rows,
      total,
      page,
      limit,
    };
  }
}

export function createIntrospector(prisma: any): DbIntrospector {
  return new SqliteIntrospector(prisma);
}
