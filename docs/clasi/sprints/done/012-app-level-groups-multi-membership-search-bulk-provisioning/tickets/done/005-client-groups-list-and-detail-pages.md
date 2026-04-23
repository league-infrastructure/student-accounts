---
id: '005'
title: "Client \u2014 Groups list and detail pages"
status: done
use-cases:
- SUC-012-001
- SUC-012-002
- SUC-012-003
- SUC-012-005
- SUC-012-006
- SUC-012-007
- SUC-012-008
depends-on:
- '004'
github-issue: ''
todo: ''
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client — Groups list and detail pages

## Description

Add the admin-facing `/groups` list page and the `/groups/:id` detail
page. Wire them into routing. Styling and structure mirror
`Cohorts.tsx` and `CohortDetailPanel.tsx` so the admin visually
recognises the pair.

## Acceptance Criteria

- [x] New file `client/src/pages/admin/Groups.tsx`:
      - Fetches `GET /api/admin/groups` via `useQuery`
        (`queryKey: ['admin', 'groups']`).
      - Renders a sortable table with columns: Name (linked to
        `/groups/:id`), Description, Members, Created.
      - Inline create form at the top with Name + Description fields;
        on submit, `POST /api/admin/groups`, invalidate the query.
      - Shows a friendly inline error on 409 / 422.
- [x] New file `client/src/pages/admin/GroupDetailPanel.tsx`:
      - Fetches `GET /api/admin/groups/:id/members`.
      - Header shows name + description + member count.
      - Header has Edit (opens an inline form backed by
        `PUT /api/admin/groups/:id`) and Delete buttons (confirms,
        `DELETE /api/admin/groups/:id`, navigates back to `/groups`).
      - **Bulk actions row** with four buttons and confirm dialogs:
        * `Create League` → `POST /bulk-provision {accountType:'workspace'}`
        * `Invite Claude` → `POST /bulk-provision {accountType:'claude'}`
        * `Suspend All` → `POST /bulk-suspend-all`
        * `Delete All` → `POST /bulk-remove-all`
        * Failure banner renders
          `userName (type): reason` on the `-all` endpoints,
          matching `CohortDetailPanel`'s format.
      - **Add member**: input with 300 ms debounce calls
        `GET /admin/groups/:id/user-search?q=...`; renders a
        dropdown of matches showing name + email; clicking a match
        POSTs to `/members` and re-fetches the member list.
      - **Member table** with columns: Name (linked), Email, League
        (StatusPill), Claude (StatusPill), Remove (confirms,
        `DELETE /admin/groups/:id/members/:userId`).
- [x] `client/src/App.tsx` adds routes inside
      `<AdminOnlyRoute>`: `/groups` → `Groups`,
      `/groups/:id` → `GroupDetailPanel`.
- [x] Sidebar navigation in `client/src/components/AppLayout.tsx`
      (or equivalent nav source-of-truth) includes a "Groups" entry
      alongside "Cohorts" (admin-only).
- [x] New tests:
      - `tests/client/Groups.test.tsx` — renders table, submits
        create form, shows inline error on duplicate, renders member
        counts.
      - `tests/client/GroupDetailPanel.test.tsx` — renders members,
        runs search-and-add, runs remove, runs each of the four bulk
        buttons, renders banner with `name (type): reason` on a
        canned 207 response.
- [x] Existing client tests continue to pass (pre-existing Sprint-010
      drift is acceptable per sprint brief).

## Testing

- **Existing tests to run**: `npm run test:client`.
- **New tests to write**: `Groups.test.tsx`,
  `GroupDetailPanel.test.tsx`.
- **Verification command**: `npm run test:client`.
