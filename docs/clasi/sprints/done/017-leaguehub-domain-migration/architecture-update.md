---
sprint: "017"
status: approved
---

# Architecture Update -- Sprint 017: LEAGUEhub Domain Migration

## What Changed

### Data Model
- **Removed**: `Channel`, `Message` models (chat demo)
- **Added 15 domain models**: `Instructor`, `Student`, `InstructorStudent`, `MonthlyReview`, `ReviewTemplate`, `ServiceFeedback`, `AdminSetting`, `Pike13Token`, `TaCheckin`, `AdminNotification`, `VolunteerHour`, `StudentAttendance`, `VolunteerSchedule`, `VolunteerEventSchedule`, `Pike13AdminToken`
- **Added enum**: `ReviewStatus` (PENDING, DRAFT, SENT)
- **Extended `User`**: added `instructors` and `notifications` relations

### Server Services (new, in ServiceRegistry)
- `InstructorService`, `StudentService`, `ReviewService`, `TemplateService`
- `CheckinService`, `FeedbackService`, `EmailService`, `Pike13SyncService`
- `VolunteerService`, `ComplianceService`, `NotificationService`

### Server Routes (new)
- `/api/instructor/*` — dashboard, students, sync
- `/api/reviews/*` — CRUD, send, generate draft
- `/api/templates/*` — CRUD
- `/api/checkins/*` — pending, submit
- `/api/feedback/:token` — public get/post
- `/api/admin/instructors`, `/api/admin/compliance`, `/api/admin/volunteer-hours`, `/api/admin/feedback`, `/api/admin/notifications`

### Server Routes (removed)
- `/api/channels/*`, `/api/messages/*`, `/api/search`

### Middleware
- Added `requireInstructor` — checks `req.user.isActiveInstructor`
- Extended Passport `deserializeUser` to load Instructor record

### Client Dependencies (added)
- `@tanstack/react-query`, `react-hook-form`, `@hookform/resolvers`, `zod`
- `tailwindcss`, `@tailwindcss/vite`, `tailwind-merge`, `clsx`, `lucide-react`

### Client Pages (new)
- Instructor: LoginPage, DashboardPage, ReviewListPage, ReviewEditorPage, TemplateListPage, TemplateEditorPage, CheckinPage, PendingActivationPage
- Public: FeedbackPage
- Admin: InstructorListPanel, CompliancePanel, VolunteerHoursPanel, AdminFeedbackPanel, NotificationsPanel

### Client Pages (removed)
- Chat.tsx, Channels.tsx

### Server Dependencies (added)
- `@sendgrid/mail`, `groq-sdk`

## Why

Replacing the chat demo with LEAGUEhub's student progress reporting domain. The template infrastructure (Prisma, Passport, ServiceRegistry, admin dashboard, Docker deployment) is retained; only the domain-specific code changes.

## Impact on Existing Components

- **ServiceRegistry**: Channel/MessageService removed, 11 new services added
- **app.ts**: Chat routers replaced with domain routers
- **App.tsx**: Chat routes replaced with instructor/admin domain routes
- **Passport deserializeUser**: Now also loads Instructor record
- **Existing admin panels**: Unchanged (users, db, logs, sessions, config, etc.)
- **MCP tools**: Chat tools (list_channels, etc.) need updating to domain tools

## Migration Concerns

- Existing SQLite dev database will be wiped (migration reset). No production data exists.
- All Drizzle PostgreSQL-specific constructs converted to SQLite-compatible Prisma equivalents.
