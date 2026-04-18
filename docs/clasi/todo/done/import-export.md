---
status: pending
priority: medium
source: inventory app (server/src/services/import.service.ts, server/src/services/export.service.ts)
---

# Excel Import/Export with Diff Detection

Add the ability to export application data to Excel (.xlsx) and import
data from spreadsheets with conflict detection and preview before
applying changes.

## Why

Users need to bulk-edit data, share it with people who don't use the app,
and migrate data from spreadsheets. Import with diff detection prevents
accidental overwrites.

## Dependencies

```
npm install exceljs
```

## Export Service

Create `server/src/services/export.service.ts`:

### exportToJson()

Returns structured JSON of all application data with relations resolved
(names instead of IDs). Useful for full database export/backup at the
application level.

### exportToExcel()

Creates a multi-sheet Excel workbook:

```typescript
async exportToExcel(): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();

  // One sheet per entity type
  const usersSheet = workbook.addWorksheet('Users');
  usersSheet.columns = [
    { header: 'ID', key: 'id', width: 10 },
    { header: 'Email', key: 'email', width: 30 },
    { header: 'Name', key: 'displayName', width: 25 },
    { header: 'Role', key: 'role', width: 15 },
  ];

  const users = await this.prisma.user.findMany();
  users.forEach(u => usersSheet.addRow(u));

  // Style header rows
  workbook.eachSheet(sheet => {
    const headerRow = sheet.getRow(1);
    headerRow.font = { bold: true };
    headerRow.fill = {
      type: 'pattern', pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
  });

  // Add _metadata sheet with export timestamp and version
  const meta = workbook.addWorksheet('_metadata');
  meta.addRow(['Exported At', new Date().toISOString()]);
  meta.addRow(['Version', process.env.npm_package_version]);

  return await workbook.xlsx.writeBuffer() as Buffer;
}
```

## Import Service

Create `server/src/services/import.service.ts`:

### parseAndDiff(file)

Parses an uploaded Excel file and compares it against existing database
records. Returns a diff report showing:

- **New records** — rows in the spreadsheet that don't exist in the DB
- **Changed records** — rows that exist but have different values
- **Unchanged records** — rows that match exactly

```typescript
interface ImportDiff {
  entityType: string;
  new: Record<string, any>[];
  changed: { existing: Record<string, any>; incoming: Record<string, any>; fields: string[] }[];
  unchanged: number;
  errors: string[];
}
```

Matching logic: match by a natural key (email for users, name for
channels, etc.), not by database ID. This allows importing data that
was exported from a different instance.

### applyImport(diff, userId)

Applies the approved changes:

- Creates new records
- Updates changed records
- Logs all changes via the AuditService with source = 'IMPORT'
- Returns a summary of what was applied

### CSV Support

Also support CSV import for simpler single-table imports:

```typescript
async parseAndDiffCsv(
  content: string,
  entityType: string
): Promise<ImportDiff>
```

## Admin Routes

- `GET /api/admin/export/json` — download JSON export
- `GET /api/admin/export/excel` — download Excel export
- `POST /api/admin/import/preview` — upload file, return diff report
- `POST /api/admin/import/apply` — apply a previously previewed import

## Admin UI

Add to the Import/Export admin panel:

- Export buttons (JSON, Excel)
- File upload with drag-and-drop
- Diff preview table showing new/changed/unchanged counts
- Per-record diff view showing old → new values for changed fields
- "Apply Import" button (only enabled after preview)

## Reference Files

- Inventory: `server/src/services/import.service.ts`
- Inventory: `server/src/services/export.service.ts`

## Verification

- Export produces a valid .xlsx file with correct data
- Import preview shows accurate diff against existing data
- Apply creates new records and updates changed ones
- Unchanged records are not modified
- All import changes are audit-logged with source = 'IMPORT'
- Errors in the spreadsheet (missing required fields, invalid values)
  are reported without crashing
