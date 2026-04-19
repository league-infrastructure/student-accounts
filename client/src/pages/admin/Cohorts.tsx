/**
 * Cohorts — admin page for viewing and creating cohorts.
 *
 * Fetches all cohorts from GET /api/admin/cohorts and displays them in a
 * table. A create form at the top allows admins to add a new cohort, which
 * triggers Google Workspace OU creation via the backend.
 *
 * Each cohort row has a "Bulk Actions" selector with four options:
 *   - Suspend Workspace
 *   - Suspend Claude
 *   - Remove Workspace
 *   - Remove Claude
 *
 * Selecting an option opens BulkActionDialog, which previews the affected
 * count and confirms/executes the operation.
 *
 * Error handling:
 *  - Page-level loading/error state for the initial fetch.
 *  - Inline form error on create failure (e.g. duplicate name → 409).
 *  - On success: query is invalidated so the list refreshes.
 */

import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { BulkActionDialog } from './BulkActionDialog';
import type { BulkAction, BulkAccountType, BulkOperation } from './BulkActionDialog';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface Cohort {
  id: number;
  name: string;
  google_ou_path: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchCohorts(): Promise<Cohort[]> {
  const res = await fetch('/api/admin/cohorts');
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

async function createCohort(name: string): Promise<Cohort> {
  const res = await fetch('/api/admin/cohorts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error((body as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return res.json();
}

// ---------------------------------------------------------------------------
// Bulk action option values
// ---------------------------------------------------------------------------

type BulkSelectValue = '' | 'suspend-workspace' | 'suspend-claude' | 'remove-workspace' | 'remove-claude';

function parseBulkSelectValue(value: BulkSelectValue): { accountType: BulkAccountType; operation: BulkOperation } | null {
  if (!value) return null;
  const [operation, accountType] = value.split('-') as [BulkOperation, BulkAccountType];
  return { operation, accountType };
}

// ---------------------------------------------------------------------------
// Cohorts component
// ---------------------------------------------------------------------------

export default function Cohorts() {
  const queryClient = useQueryClient();
  const [newName, setNewName] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [bulkAction, setBulkAction] = useState<BulkAction | null>(null);

  const { data: cohorts, isLoading, error } = useQuery<Cohort[], Error>({
    queryKey: ['admin', 'cohorts'],
    queryFn: fetchCohorts,
  });

  const createMutation = useMutation<Cohort, Error, string>({
    mutationFn: createCohort,
    onSuccess: () => {
      setNewName('');
      setFormError(null);
      queryClient.invalidateQueries({ queryKey: ['admin', 'cohorts'] });
    },
    onError: (err) => {
      setFormError(err.message);
    },
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const trimmed = newName.trim();
    if (!trimmed) {
      setFormError('Cohort name must not be blank.');
      return;
    }
    createMutation.mutate(trimmed);
  }

  function handleBulkSelect(cohort: Cohort, value: BulkSelectValue) {
    const parsed = parseBulkSelectValue(value);
    if (!parsed) return;
    setBulkAction({
      cohortId: cohort.id,
      cohortName: cohort.name,
      accountType: parsed.accountType,
      operation: parsed.operation,
    });
  }

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  if (isLoading) {
    return <p style={loadingStyle}>Loading cohorts...</p>;
  }

  if (error) {
    return (
      <p style={errorStyle}>
        Failed to load cohorts: {error.message}
      </p>
    );
  }

  return (
    <div>
      <h2 style={headingStyle}>Cohorts</h2>

      {/* Create form */}
      <form onSubmit={handleSubmit} style={formStyle}>
        <input
          type="text"
          placeholder="New cohort name"
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          style={inputStyle}
          aria-label="New cohort name"
          disabled={createMutation.isPending}
        />
        <button
          type="submit"
          style={submitButtonStyle}
          disabled={createMutation.isPending}
        >
          {createMutation.isPending ? 'Creating...' : 'Create Cohort'}
        </button>
        {formError && (
          <span style={inlineErrorStyle} role="alert">
            {formError}
          </span>
        )}
      </form>

      {/* Cohort list */}
      {cohorts && cohorts.length === 0 ? (
        <p style={emptyStyle}>No cohorts yet.</p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Name</th>
              <th style={thStyle}>Google OU Path</th>
              <th style={thStyle}>Created On</th>
              <th style={thStyle}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {(cohorts ?? []).map((cohort) => (
              <tr key={cohort.id}>
                <td style={tdStyle}>{cohort.name}</td>
                <td style={tdStyle}>{cohort.google_ou_path ?? '-'}</td>
                <td style={tdStyle}>
                  {new Date(cohort.createdAt).toLocaleDateString()}
                </td>
                <td style={tdStyle}>
                  <select
                    style={bulkSelectStyle}
                    value=""
                    aria-label={`Bulk actions for ${cohort.name}`}
                    onChange={(e) =>
                      handleBulkSelect(cohort, e.target.value as BulkSelectValue)
                    }
                  >
                    <option value="" disabled>Bulk Actions</option>
                    <option value="suspend-workspace">Suspend Workspace</option>
                    <option value="suspend-claude">Suspend Claude</option>
                    <option value="remove-workspace">Remove Workspace</option>
                    <option value="remove-claude">Remove Claude</option>
                  </select>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Bulk action dialog */}
      {bulkAction && (
        <BulkActionDialog
          action={bulkAction}
          onClose={() => setBulkAction(null)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const headingStyle: React.CSSProperties = {
  margin: '0 0 16px',
  fontSize: 20,
};

const loadingStyle: React.CSSProperties = {
  color: '#64748b',
};

const errorStyle: React.CSSProperties = {
  color: '#dc2626',
};

const emptyStyle: React.CSSProperties = {
  color: '#94a3b8',
  textAlign: 'center',
  marginTop: 24,
};

const formStyle: React.CSSProperties = {
  display: 'flex',
  gap: 8,
  alignItems: 'center',
  flexWrap: 'wrap',
  marginBottom: 24,
};

const inputStyle: React.CSSProperties = {
  padding: '6px 10px',
  fontSize: 14,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  minWidth: 240,
};

const submitButtonStyle: React.CSSProperties = {
  padding: '6px 14px',
  fontSize: 14,
  background: '#4f46e5',
  color: '#fff',
  border: 'none',
  borderRadius: 4,
  cursor: 'pointer',
  fontWeight: 600,
};

const inlineErrorStyle: React.CSSProperties = {
  color: '#dc2626',
  fontSize: 13,
};

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontSize: 14,
};

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  padding: '8px 12px',
  borderBottom: '2px solid #e2e8f0',
  fontWeight: 600,
  fontSize: 13,
  color: '#64748b',
};

const tdStyle: React.CSSProperties = {
  padding: '8px 12px',
  borderBottom: '1px solid #f1f5f9',
  verticalAlign: 'top',
};

const bulkSelectStyle: React.CSSProperties = {
  padding: '4px 8px',
  fontSize: 13,
  border: '1px solid #cbd5e1',
  borderRadius: 4,
  background: '#fff',
  cursor: 'pointer',
};
