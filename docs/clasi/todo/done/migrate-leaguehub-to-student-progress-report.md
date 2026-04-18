---
status: done
sprint: '017'
tickets:
- 017-001
---

# Migrate LEAGUEhub-orig to student-progress-report template

## Description
Port all domain logic from /Users/eric/proj/scratch/LEAGUEhub-orig into the student-progress-report template application. The source app is a student progress reporting tool for The LEAGUE of Amazing Programmers using Express + Drizzle/PostgreSQL, Pike13 OAuth, React/Wouter/Tailwind. The target is a template app with Express + Prisma (dual SQLite/PostgreSQL), Passport.js OAuth, service registry pattern, React Router. Currently running a chat demo that needs to be replaced with LEAGUEhub's student progress features.

## Acceptance Criteria
- `npm run dev` starts both server and client without errors
- All LEAGUEhub domain models exist in Prisma schema (Instructor, Student, MonthlyReview, ReviewTemplate, etc.)
- Chat infrastructure (channels, messages, SSE) fully removed
- Pike13 OAuth flow creates instructor records and stores tokens
- All instructor pages work: dashboard, reviews, templates, checkins
- All admin pages work: instructor list, compliance, volunteer hours, feedback
- Public feedback form works via token URL
- SendGrid email integration works (graceful no-op without API key)
- Pike13 sync service works (graceful no-op without credentials)
- Docker build succeeds
- Deployment via rundbat/dotconfig preserved

## Approach

Most work is copying files from LEAGUEhub-orig and adapting them to the template's patterns:
- **Prisma schema**: rewrite from Drizzle (can't copy directly — different ORM syntax)
- **Service classes**: new wrappers — LEAGUEhub has logic inline in routes; template requires ServiceRegistry pattern. Extract logic from route handlers into service classes.
- **Route handlers**: copy from LEAGUEhub, adapt `db.select()` → `prisma.*`, `req.session.user` → `req.user`, wrap in ServiceRegistry
- **Client pages/components/types**: copy from LEAGUEhub, adapt Wouter → React Router, swap `useAuth` hook → AuthContext
- **email.ts, pike13Sync.ts**: copy, convert Drizzle queries to Prisma

Source: `/Users/eric/proj/scratch/LEAGUEhub-orig/`

## Tasks

### Phase 1: Prisma Schema + DB Foundation
- [ ] Rewrite Drizzle schema (server/src/db/schema.ts) as Prisma models in schema.prisma — remove Channel/Message, add 15 LEAGUEhub models + ReviewStatus enum
- [ ] Update User model relations (add instructors, notifications; remove messages)
- [ ] Delete existing migration, regenerate clean init migration
- [ ] Update seed script: remove channel seed

### Phase 2: Remove Chat, Add Client Dependencies
- [ ] Delete server chat files (channels.ts, messages.ts, search.ts routes; channel/message services, sse.ts)
- [ ] Strip chat imports/routes from app.ts and service.registry.ts
- [ ] Install client deps: @tanstack/react-query, react-hook-form, @hookform/resolvers, zod, tailwindcss, @tailwindcss/vite, tailwind-merge, clsx, lucide-react
- [ ] Configure Tailwind (vite plugin + index.css import)
- [ ] Delete Chat.tsx, Channels.tsx; strip chat routes from App.tsx

### Phase 3: Domain Services (extract from LEAGUEhub route handlers)
- [ ] Extract route logic into service classes: instructor, student, review, template, checkin, feedback, volunteer, compliance, notification
- [ ] Copy + adapt email.ts and pike13Sync.ts (Drizzle → Prisma, SQLite-safe)
- [ ] Register all services in service.registry.ts; update clearAll()
- [ ] Install server deps: @sendgrid/mail, groq-sdk

### Phase 4: Auth + Middleware
- [ ] Extend Passport deserializeUser to load Instructor record, attach instructorId/isActiveInstructor
- [ ] Adapt pike13.ts callback with LEAGUEhub's domain logic (email domain check, instructor creation, token storage)
- [ ] Copy + adapt requireInstructor middleware from LEAGUEhub's auth.ts isActiveInstructor check
- [ ] Add instructorId/isActiveInstructor to Express.User type and client AuthContext

### Phase 5: Domain Route Handlers
- [ ] Copy + adapt route handlers from LEAGUEhub (instructor, reviews, templates, checkins, feedback) — change Drizzle → service calls, req.session.user → req.user
- [ ] Copy + adapt admin routes (instructors, compliance, volunteer-hours, feedback, notifications)
- [ ] Mount all routes in app.ts and admin/index.ts

### Phase 6: Client — Instructor Pages
- [ ] Copy components from LEAGUEhub: InstructorLayout, ProtectedRoute, MonthPicker, ui/button, ui/input, lib/utils.ts — adapt Wouter → React Router
- [ ] Copy type definitions from LEAGUEhub client/src/types/ (mostly as-is)
- [ ] Copy + adapt pages: LoginPage, DashboardPage, ReviewListPage, ReviewEditorPage, TemplateListPage, TemplateEditorPage, CheckinPage, FeedbackPage, PendingActivationPage — swap Wouter → React Router, useAuth → AuthContext, wrap fetches in React Query
- [ ] Wire up: QueryClientProvider in main.tsx, routes in App.tsx

### Phase 7: Client — Admin Pages
- [ ] Copy + adapt admin pages from LEAGUEhub: InstructorList, Compliance, VolunteerHours, AdminFeedback, Notifications
- [ ] Add nav items to AdminLayout, add routes to App.tsx

### Phase 8: Cleanup + Verification
- [ ] Update .env: APP_NAME=LEAGUEhub, APP_SLUG=leaguehub
- [ ] Remove any remaining chat references
- [ ] Verify npm run dev starts cleanly
- [ ] Verify login flow, dashboard, review CRUD, admin panels
- [ ] Verify Docker build succeeds
