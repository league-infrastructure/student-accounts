import { useEffect, useState } from 'react';

interface TableMeta {
  name: string;
  rowCount: number;
}

interface Column {
  name: string;
  type: string;
  nullable: boolean;
}

interface TableData {
  columns: Column[];
  rows: Record<string, unknown>[];
  total: number;
  page: number;
  limit: number;
}

function CellValue({ value }: { value: unknown }) {
  if (value === null) return <span style={{ color: '#999', fontStyle: 'italic' }}>null</span>;
  if (typeof value === 'object') {
    return (
      <details>
        <summary style={{ cursor: 'pointer', color: '#666' }}>JSON</summary>
        <pre style={{ fontSize: 12, maxWidth: 400, overflow: 'auto' }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      </details>
    );
  }
  return <>{String(value)}</>;
}

interface DbInfo {
  provider: string;
  connectionString: string;
}

export default function DatabaseViewer() {
  const [dbInfo, setDbInfo] = useState<DbInfo | null>(null);
  const [tables, setTables] = useState<TableMeta[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tableData, setTableData] = useState<TableData | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/admin/db/info')
      .then((r) => r.json())
      .then(setDbInfo)
      .catch(() => {});
    fetch('/api/admin/db/tables')
      .then((r) => r.json())
      .then(setTables)
      .catch(() => setError('Failed to load tables'));
  }, []);

  useEffect(() => {
    if (!selected) { setTableData(null); return; }
    setLoading(true);
    fetch(`/api/admin/db/tables/${encodeURIComponent(selected)}?page=${page}&limit=50`)
      .then((r) => r.json())
      .then((d) => { setTableData(d); setLoading(false); })
      .catch(() => { setError('Failed to load table data'); setLoading(false); });
  }, [selected, page]);

  if (error) return <div style={{ color: 'red' }}>{error}</div>;

  const totalPages = tableData ? Math.ceil(tableData.total / tableData.limit) : 0;

  return (
    <div>
      <h1>Database</h1>

      {dbInfo && (
        <div style={{ marginBottom: 20, padding: '10px 14px', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, fontSize: 13 }}>
          <span style={{ color: '#64748b' }}>Provider:</span>{' '}
          <strong>{dbInfo.provider}</strong>
          <span style={{ margin: '0 12px', color: '#cbd5e1' }}>|</span>
          <span style={{ color: '#64748b' }}>Connection:</span>{' '}
          <code style={{ fontSize: 12 }}>{dbInfo.connectionString}</code>
        </div>
      )}

      <div style={{ display: 'flex', gap: 24 }}>
        {/* Table list */}
        <div style={{ minWidth: 200 }}>
          <h3>Tables</h3>
          {tables.map((t) => (
            <div
              key={t.name}
              onClick={() => { setSelected(t.name); setPage(1); }}
              style={{
                padding: '8px 12px',
                cursor: 'pointer',
                background: selected === t.name ? '#e8f0fe' : 'transparent',
                borderRadius: 4,
                marginBottom: 2,
              }}
            >
              <strong>{t.name}</strong>
              <span style={{ color: '#666', marginLeft: 8, fontSize: 13 }}>
                ({t.rowCount})
              </span>
              {t.name === '_prisma_migrations' && (
                <span style={{ color: '#999', fontSize: 11, marginLeft: 4 }}>internal</span>
              )}
            </div>
          ))}
        </div>

        {/* Record viewer */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {!selected && <p style={{ color: '#666' }}>Select a table to view its records.</p>}
          {selected && loading && <p>Loading...</p>}
          {selected && tableData && (
            <>
              <h3>{selected} ({tableData.total} rows)</h3>
              {tableData.rows.length === 0 ? (
                <p style={{ color: '#666' }}>No records</p>
              ) : (
                <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 13 }}>
                  <thead>
                    <tr>
                      {tableData.columns.map((col) => (
                        <th
                          key={col.name}
                          style={{
                            textAlign: 'left',
                            padding: '6px 10px',
                            borderBottom: '2px solid #ddd',
                            whiteSpace: 'nowrap',
                          }}
                        >
                          {col.name}
                          <span style={{ color: '#999', fontSize: 11, marginLeft: 4 }}>
                            {col.type}
                          </span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {tableData.rows.map((row, i) => (
                      <tr key={i} style={{ borderBottom: '1px solid #eee' }}>
                        {tableData.columns.map((col) => (
                          <td key={col.name} style={{ padding: '4px 10px', verticalAlign: 'top' }}>
                            <CellValue value={row[col.name]} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}

              {totalPages > 1 && (
                <div style={{ marginTop: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                  <button disabled={page <= 1} onClick={() => setPage(page - 1)}>Prev</button>
                  <span>Page {page} of {totalPages}</span>
                  <button disabled={page >= totalPages} onClick={() => setPage(page + 1)}>Next</button>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
