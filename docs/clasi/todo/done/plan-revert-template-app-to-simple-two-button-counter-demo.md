---
status: done
sprint: 018
tickets:
- 018-001
- 018-002
- 018-003
- 018-004
- 018-005
- 018-006
---

# Plan — Revert Template App to Simple Two-Button Counter Demo

## Context

This repo (`docker-node-template`) is meant to be a **reusable starter template** for web applications. Over time it has drifted into a production-specific application — "LEAGUEhub", an instructor-facing student-progress-report tool integrated with Pike13 OAuth. The domain-specific content (students, reviews, templates, check-ins, feedback, Pike13 sync, volunteer hours) is not appropriate for a template.

We need to strip the domain-specific code back down to a minimal demo while **keeping the valuable infrastructure** that has accumulated around it (Docker setup, CLASI process scaffolding, admin panels, dual-DB support, session-based auth, app shell, MCP setup page).

**Target end-state:**

1. **Login page** — simple username + password form, pre-filled with `user` / `pass`. No OAuth, no email domain check, no Pike13. Two hardcoded credential pairs: `user`/`pass` logs in as `USER` role; `admin`/`admin` logs in as `ADMIN` role.
2. **Home page (`/`)** — two buttons, two named counters (`alpha` and `beta`). Each button increments its own counter; both current values are displayed.
3. **Shared shell (AppLayout)** — topbar with username + account dropdown (Account / Log out); sidebar with Home, MCP Setup, About, Configuration (admin-only, links to `/admin/config`), and Admin link (admin-only).
4. **Admin section** — kept intact for now; the user will audit it separately after login is sorted.

Because the existing `AppLayout` already has the correct structure (topbar with user/role/dropdown, sidebar with main/bottom/admin nav), the "structure" initiative is mostly a **verification + cleanup** task, not a rewrite.

---

## Approach

**Strip-in-place on current code.** Do *not* roll back via git — the current branch has valuable Docker and CLASI scaffolding commits (`ac0606c`, `9605eca`, `f405eb0`, `4899cd4`, `f710d7d`) that we want to keep. Instead, delete the student/progress domain layer surgically.

We considered cherry-picking from commit `8de713f` (pre-LEAGUEhub merge of sprint/004 — had auth + admin + counter, no student stuff) but that loses Docker/CLASI work. Surgical strip-out is cleaner.

---

## Deliverable: Two CLASI TODO files

The user asked for two todos. These will be written to `docs/clasi/todo/` via the `/todo` skill after plan approval. They will flow through the normal CLASI pipeline (architecture → sprint → tickets → implementation).

### TODO #1 — Strip domain layer and add counter demo

**Title:** `strip-domain-and-add-counter-demo`

**Scope — delete:**

- **Frontend pages**: [DashboardPage.tsx](client/src/pages/DashboardPage.tsx), [ReviewListPage.tsx](client/src/pages/ReviewListPage.tsx), [ReviewEditorPage.tsx](client/src/pages/ReviewEditorPage.tsx), [TemplateListPage.tsx](client/src/pages/TemplateListPage.tsx), [TemplateEditorPage.tsx](client/src/pages/TemplateEditorPage.tsx), [CheckinPage.tsx](client/src/pages/CheckinPage.tsx), [FeedbackPage.tsx](client/src/pages/FeedbackPage.tsx), [PendingActivationPage.tsx](client/src/pages/PendingActivationPage.tsx)
- **Frontend components**: [InstructorLayout.tsx](client/src/components/InstructorLayout.tsx), [MonthPicker.tsx](client/src/components/MonthPicker.tsx) (if domain-specific)
- **Backend routes**: [routes/instructor.ts](server/src/routes/instructor.ts), [routes/reviews.ts](server/src/routes/reviews.ts), [routes/templates.ts](server/src/routes/templates.ts), [routes/checkins.ts](server/src/routes/checkins.ts), [routes/feedback.ts](server/src/routes/feedback.ts), [routes/pike13.ts](server/src/routes/pike13.ts)
- **Backend services**: any under [server/src/services/](server/src/services/) tied to Instructor/Student/Review/Template/Pike13/Checkin/Feedback/VolunteerHour/Attendance
- **Admin panels that are domain-specific**: [InstructorListPanel](client/src/pages/admin/InstructorListPanel.tsx), [CompliancePanel](client/src/pages/admin/CompliancePanel.tsx), [VolunteerHoursPanel](client/src/pages/admin/VolunteerHoursPanel.tsx), [AdminFeedbackPanel](client/src/pages/admin/AdminFeedbackPanel.tsx) — and their backend routes/services
- **Prisma models** in [schema.prisma](server/prisma/schema.prisma): `Instructor`, `Student`, `InstructorStudent`, `MonthlyReview`, `ReviewTemplate`, `ServiceFeedback`, `Pike13Token`, `TaCheckin`, `AdminNotification`, `VolunteerHour`, `StudentAttendance`, `VolunteerSchedule`, `VolunteerEventSchedule`, `Pike13AdminToken`, `AdminSetting`, `ReviewStatus` enum, plus relation fields off `User`
- **Prisma migration**: create a new migration that drops the dropped tables
- **Tests** that exclusively cover deleted features

**Scope — add:**

- **`Counter` model** in Prisma: `id`, `name String @unique`, `value Int @default(0)`, `updatedAt DateTime @updatedAt`
- **Backend routes** in new [routes/counters.ts](server/src/routes/counters.ts):
  - `GET /api/counters` → list all counters
  - `POST /api/counters/:name/increment` → increment and return new value; auto-create row on first use
- **Seed script** that inserts two counters named `alpha` and `beta` with value `0`
- **New home page** at [client/src/pages/HomePage.tsx](client/src/pages/HomePage.tsx) — displays `alpha` and `beta` values, with one button per counter that calls `POST /api/counters/:name/increment` via React Query
- **Demo login endpoint** `POST /api/auth/demo-login` in [routes/auth.ts](server/src/routes/auth.ts):
  - Reads `username` + `password` from body
  - If `user`/`pass` → finds-or-creates `User { email: "user@demo.local", role: USER }` and calls `req.login()`
  - If `admin`/`admin` → finds-or-creates `User { email: "admin@demo.local", role: ADMIN }` and calls `req.login()`
  - Else → 401
- **New LoginPage** — replaces OAuth button with a form. Username and password inputs are pre-filled with `user` and `pass`. Submit POSTs to `/api/auth/demo-login`. Shows error on 401.
- Strip Pike13 OAuth + Passport Google/GitHub strategies (but keep express-session + Passport core so `req.login()` still works)

**Acceptance:**

- `docker compose up` brings the app up.
- `/login` shows a pre-filled username/password form.
- Submitting `user`/`pass` lands on `/` with two buttons and two counter values.
- Clicking a button increments its counter and the display updates.
- `admin`/`admin` works and shows Admin link in sidebar.
- No route, schema model, or React component in the codebase references students/reviews/templates/checkins/feedback/Pike13/volunteer.
- Tests that remain all pass.

### TODO #2 — Verify and tighten app shell structure

**Title:** `verify-app-shell-structure`

**Scope:**

- Audit [AppLayout.tsx](client/src/components/AppLayout.tsx) sidebar nav arrays against the desired structure:
  - `MAIN_NAV`: `Home` only (already correct after TODO #1)
  - `BOTTOM_NAV`: `MCP Setup`, `About`
  - Add a **Configuration** link that points to `/admin/config` and is only rendered when `user.role === ADMIN` (mirrors the existing Admin link visibility)
  - Admin link conditionally shown when `user.role === ADMIN` (already in place)
- Verify topbar renders: hamburger (mobile) → spacer → avatar → displayName (clickable to `/account`) → role badge → dropdown with `Account` + `Log out`
- Verify `AppLayout` hides itself on `/login` and redirects unauthenticated users to `/login`
- Remove any leftover LEAGUEhub branding (logo URL, "LEAGUE Progress Report" strings, `appName` default of `"LEAGUEhub"`)
- Update [README](README.md) / [docs/template-spec.md](docs/template-spec.md) to describe the template as a generic counter demo rather than LEAGUEhub

**Acceptance:**

- The sidebar shows Home, MCP Setup, About for all users; Configuration and Admin only for admins
- The topbar dropdown shows Account and Log out
- No visible references to "LEAGUEhub", Pike13, students, reviews, etc.
- Mobile hamburger still works

---

## Critical files (reference during execution)

- [client/src/App.tsx](client/src/App.tsx) — route table; prune student/progress routes, add `/` → HomePage
- [client/src/components/AppLayout.tsx](client/src/components/AppLayout.tsx) — nav arrays `MAIN_NAV`, `BOTTOM_NAV`, `ADMIN_NAV`
- [client/src/pages/LoginPage.tsx](client/src/pages/LoginPage.tsx) — replace OAuth button with form
- [client/src/context/AuthContext.tsx](client/src/context/AuthContext.tsx) — may need a `loginWithCredentials(u, p)` helper
- [server/src/routes/auth.ts](server/src/routes/auth.ts) — add `demo-login` endpoint, remove OAuth strategies
- [server/src/app.ts](server/src/app.ts) — unregister deleted routers, register counters router
- [server/prisma/schema.prisma](server/prisma/schema.prisma) — schema pruning + `Counter` model
- [server/src/middleware/requireAuth.ts](server/src/middleware/requireAuth.ts) — unchanged (already checks `req.user`)

## Reusable infrastructure (keep, don't reinvent)

- `express-session` + `PrismaSessionStore` — already wired up; `req.login()` works out of the box once Passport's local serialization is in place
- `AuthContext` pattern with `GET /api/auth/me` — keep; just change the login trigger
- `requireAuth` / `requireAdmin` middleware — keep unchanged
- `AppLayout` shell — keep as-is structurally, only prune content
- Admin infra panels (Users, Env, DB, Config, Logs, Sessions, Permissions, Scheduler, Import/Export) — keep; user will review later
- Prisma dual-DB support (SQLite local, Postgres prod) — keep

---

## Decisions (confirmed with stakeholder)

1. **Admin account:** two credential pairs — `user`/`pass` → USER, `admin`/`admin` → ADMIN.
2. **Counter design:** two separately-named counters (`alpha` and `beta`), one button per counter.
3. **Configuration link:** points to the existing `/admin/config` panel; sidebar entry visible only to admins.

## Verification plan (after implementation)

1. `rundbat` MCP tools → start dev database
2. `npm run dev` in both client and server (or `docker compose up` if preferred)
3. Navigate to `http://localhost:<port>/login` — confirm pre-filled form
4. Submit `user`/`pass` — land on `/` with counter UI
5. Click each button — confirm values increment and persist across reload
6. Log out → log in as `admin`/`admin` → confirm Admin link appears
7. Verify `/admin/*` routes still load (content audit is TODO #3, not this pass)
8. Run server test suite — all remaining tests pass
9. `grep -ri "pike13\|instructor\|student\|review\|template\|checkin\|leaguehub" client/src server/src` returns only hits that are genuinely generic English or in `node_modules`

---

## Out of scope for these TODOs

- Auditing/pruning the admin section itself (user will handle after login is fixed — potential TODO #3)
- Any production deployment changes
- CI/CD adjustments
