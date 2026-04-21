---
id: "010"
title: "Build AuditLogPanel page with filter form, paginated results, and detail expansion"
status: done
use-cases: [SUC-009-008]
depends-on: ["005"]
github-issue: ""
todo: ""
---

# Build AuditLogPanel page with filter form, paginated results, and detail expansion

## Description

Build the admin `AuditLogPanel.tsx` page at `/admin/audit-log`. It shows a
filter form and a paginated table of AuditEvent records fetched from the T005
endpoint. Clicking a row expands the full `details` JSON inline.

## Acceptance Criteria

- [x] Page renders at `/admin/audit-log` (admin-only via `AdminLayout`).
- [x] Filter form contains: target user text input, actor text input, action
      type dropdown (known action strings + "All"), date range (start date
      input, end date input).
- [x] Filter is applied on form submit (or on change — ticket engineer's
      discretion, submit is simpler).
- [x] Results table columns: Timestamp, Actor, Action, Target User, Details
      summary (first 80 chars of stringified details).
- [x] Results are in reverse chronological order (server-side).
- [x] Pagination: "Page N of M — Previous / Next" controls below the table.
      Page size: 50.
- [x] Clicking a row toggles an expanded detail section below it showing the
      raw `details` JSON formatted with `JSON.stringify(details, null, 2)` in
      a `<pre>` block.
- [x] Empty state: "No audit records match the current filters." when
      `total === 0`.
- [x] Loading spinner while fetching.
- [x] Error banner if the fetch fails.

## Implementation Plan

**Files to create:**
- `client/src/pages/admin/AuditLogPanel.tsx`

**Files to modify:**
- `client/src/App.tsx` — add route (coordinated with T011).
- Admin nav in `AppLayout.tsx` — add "Audit Log" link (admin-only, coordinated
  with T011).

**State:**
```typescript
const [filters, setFilters] = useState<AuditFilters>({
  targetUser: '', actor: '', action: '', from: '', to: ''
});
const [page, setPage] = useState(1);
const [result, setResult] = useState<AuditLogResult | null>(null);
const [loading, setLoading] = useState(false);
const [expandedId, setExpandedId] = useState<number | null>(null);
```

**Fetch:**
Build a query string from `filters` + `page`, call `GET /api/admin/audit-log`,
update `result`.

**Action type dropdown options:** The known action strings include at minimum:
`provision_workspace`, `provision_claude`, `suspend_workspace`, `suspend_claude`,
`remove_workspace`, `remove_claude`, `add_login`, `remove_login`,
`create_cohort`, `merge_approve`, `merge_reject`, `pike13_writeback_github`,
`pike13_writeback_email`, `delete_user`. Plus "All" as the default.

**Testing plan:**
- Manual: navigate to `/admin/audit-log`; verify table loads with all events.
- Manual: filter by action type; verify only matching rows returned.
- Manual: filter by date range; verify correct rows.
- Manual: click a row; verify details JSON expands; click again to collapse.
- Manual: use pagination controls to go to page 2 when >50 results exist.

**Documentation updates:** None required.
