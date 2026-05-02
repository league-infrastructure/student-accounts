---
status: done
sprint: '025'
tickets:
- '001'
- '002'
- '003'
- '004'
- '005'
- '006'
- '007'
---

# Backlog: User Management v2 + Account login UX + cohort drop

Stakeholder asks captured 2026-05-02 after sprint 024 close. These
should ship as a single sprint (or split if the cohort drop turns
out heavy) — bundling because they touch the same surfaces.

---

## A. Confirmation before removing a login provider

**Where:** `client/src/pages/Account.tsx` `LoginsSection` — the
"Remove" button on each linked login (around the `removeLoginMutation`
in the existing table).

**What:** Add a confirmation step before calling the DELETE. Native
`window.confirm()` is fine for v1 ("Remove the {provider} login from
your account? You can re-link it later by clicking the Add {provider}
button.") — keeps it simple. If we want a styled modal later, that's
a follow-up.

**Why:** Stakeholder hit "Remove" without realizing it was destructive.

---

## B. Bug — `eric@civicknowledge.com` student account missing from Students list

**Symptom:** Stakeholder has a real student account at
`eric@civicknowledge.com` but it's absent from the Students list at
`/users/students` (StudentAccountsPanel).

**Likely cause:** `StudentAccountsPanel` filters the
`/api/admin/users` response client-side. The current filter rule is
something like "primary_email matches `@jointheleague.org`" or
"role === 'student'" or both. If the filter expects a League email
but the student row has a `civicknowledge.com` email, it gets
excluded even though `role === 'student'`.

**What to do:**

1. Read the filter in `client/src/pages/admin/StudentAccountsPanel.tsx`
   to confirm the predicate.
2. The right rule is **`role === 'student'`** — drop any email-domain
   gating on this list. The role tells us; the email doesn't.
3. Same audit for `AdminUsersPanel` "All users" view: it should not
   filter out anyone by email domain.
4. Add a regression test for a `role: 'student'` user with a
   non-League email — must appear in the Students list.

This bug is independent of the larger restructure in C below; ship
it first if we split the sprint.

---

## C. Users page consolidation — single page with lozenge filters

The Users / Students / Staff / LLM Proxy Users panels collapse into
**one** page. The sidebar User Management group shrinks to two
children:

```
[User Management] ▾
  ├── User Management   →  /admin/users   (the unified panel)
  └── Groups            →  /groups
```

**Cohorts is removed from the sidebar entirely.** See item D.

### New Users panel UX

```
┌────────────────────────────────────────────────────────────┐
│ [Search _________________]  [All|Staff|Admin|Student]      │
│                             [Google][Pike13][GitHub]       │
│                             [LLM Proxy][OAuth Client]      │
├────────────────────────────────────────────────────────────┤
│ Name      Email           Role     Accounts   Joined       │
│ ...                                                        │
└────────────────────────────────────────────────────────────┘
```

- **Search bar** (existing): name + email substring, client-side.
- **Role filter** — radio-style lozenge group, exactly one selected:
  `All` | `Staff` | `Admin` | `Student`. Clicking one toggles the
  others off. Default: `All`.
- **Feature filter** — toggle-style lozenge group, multi-select
  (each independently on/off). Five toggles:
  - **Google** — user has ≥1 `google` Login.
  - **Pike 13** — user has ≥1 `pike13` Login.
  - **GitHub** — user has ≥1 `github` Login.
  - **LLM Proxy** — user has an active LLM proxy token
    (`llmProxyEnabled === true`, mirroring the Account profile flag).
  - **OAuth Client** — user owns ≥1 OAuth client (`created_by`).
- **Multi-toggle semantics** — when more than one feature toggle is
  on, results are the **intersection** (user must have ALL selected
  features). If none are on, no feature filter applies.
- **Filter changes re-run the filter immediately** — visible result
  set updates on every click.
- **Remove the existing "Filter" dropdown** (role / account-type /
  cohort dropdown) from the page.
- Sortable column headers preserved (Name, Email, Cohort, Joined).
- The Cohort column can stay (it's still on the User row); it just
  isn't filterable by lozenge.

### Backend

The current `/api/admin/users` endpoint already returns the fields
needed for these filters (logins, llmProxyEnabled, ownedOauthClient
count) — verify; if any are missing, the cleanest fix is to extend
the endpoint response. Filtering is client-side (datasets are small).

If `ownedOauthClient` count is not on the response, add it:
`server/src/routes/admin/users.ts` should join/aggregate the
OAuthClient table and return e.g. `oauthClientCount: number` per
user.

### Sidebar tickets to absorb

- Drop the Students, Staff, LLM Proxy Users, Cohorts items from the
  sidebar User Management group.
- Routes `/users/students`, `/users/llm-proxy`, `/staff/directory`,
  `/cohorts` may stay or be deleted. Recommendation: delete them,
  drop the redirects, drop the page files (`StudentAccountsPanel`,
  `LlmProxyUsersPanel`, `StaffDirectory`, `Cohorts`). The unified
  Users panel covers their use cases via the lozenge filters.

---

## D. Drop Cohort as a top-level concept

**Stakeholder direction (verbatim):**
> Let's just get rid of the cohort group. Instead, when we
> synchronize with Google, we import all the accounts, and then
> we import the cohorts as groups, but they're not called out
> separately as cohorts. They're linked to cohorts, but they're
> separate as cohorts when you import those accounts. All become
> students.

**Interpretation:** Cohorts disappear from the UI and as a
first-class navigation concept. The synchronization flow that
currently creates Cohort rows from Google OUs (or wherever) now
creates Group rows instead. Imported accounts default to
`role: 'student'`.

**What to do (likely sprint scope):**

1. Sidebar: drop the Cohorts entry.
2. Page: delete `client/src/pages/admin/Cohorts.tsx` and its detail
   page (`CohortDetailPanel`); drop `/cohorts` and `/cohorts/:id`
   routes.
3. User table: keep the `cohort_id` column for now (data migration
   is risky). Account.tsx and the Users panel stop displaying it
   prominently — or we hide the column entirely. **Confirm with
   stakeholder whether to hide the Cohort column on the Users
   panel** (default: hide).
4. Sync logic — the Google Workspace sync currently writes Cohort
   rows. Change it to write Group rows instead (with the same name).
   Existing Cohort↔User assignments could be migrated to
   Group↔User membership rows in a one-time backfill, or left in
   place and gradually decay. **Confirm migration strategy with
   stakeholder.**
5. Imported users default to `role: 'student'` regardless of OU
   (current code may already do this — verify).
6. Audit-event names referencing cohorts can stay; the Cohort
   table can stay in the schema (no migration in this sprint) — UI
   just stops surfacing it.

**Open question:** Do we delete the Cohort Prisma model (and
migrate data into Group), or just stop surfacing it? Default
recommendation: **stop surfacing now; schedule migration as a
follow-up sprint** to keep the blast radius small.

---

## Stakeholder decisions (locked 2026-05-02)

- **Cohort column on the unified Users panel:** HIDE entirely.
- **Cohort data migration to Groups:** DEFER. Just stop surfacing
  cohorts in the sidebar/page; redirect sync writes to Groups going
  forward. Backfill of existing Cohort↔User assignments into Group
  membership rows is a follow-up sprint.
- **Login-removal confirmation widget:** custom in-page modal,
  styled to match the rest of the app. Add a small reusable
  `<ConfirmDialog>` if we don't already have one — search the
  codebase first; don't duplicate.

Outstanding investigation (not a stakeholder question — happens
during ticket execution):

- Does the Google Workspace sync currently write Cohort rows?
  Read the sync code (`server/src/services/sync/*` or similar)
  before sizing ticket 6. If yes → that ticket flips the writes to
  Groups; if no → ticket 6 is just "drop the Cohorts UI, leave the
  sync alone".

## Recommended sprint shape

- **Ticket 1**: Confirmation before login removal (item A).
- **Ticket 2**: Fix Students-list email-domain bug (item B).
- **Ticket 3**: Backend — extend `/api/admin/users` with
  `oauthClientCount` (and verify `llmProxyEnabled` is exposed).
- **Ticket 4**: Client — unified Users panel with lozenge filters
  (item C).
- **Ticket 5**: Sidebar shrink + delete now-orphaned pages
  (Students, Staff, LLM Proxy Users, Cohorts).
- **Ticket 6**: Investigate and update sync code so cohort imports
  become Group writes (item D, deferred-migration variant).
- **Ticket 7**: Manual smoke (stakeholder verification).
