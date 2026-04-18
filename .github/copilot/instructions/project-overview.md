---
status: draft
---

# Project Overview

## Project Name

College Application Navigator

## Problem Statement

Most high school students navigate the college application process without a
clear roadmap. They rely on overworked school counselors, scattered internet
research, and word of mouth — a system that consistently favors students who
already have resources, connections, and informed parents. The result is that
many capable students either under-apply (aiming too low), over-apply
inefficiently (wasting effort), or miss critical deadlines and opportunities
entirely.

There is no single, personalized guide that walks a student through the entire
journey — from course selection in 8th grade through enrollment in 12th —
adapting to that student's specific profile, goals, and timeline.

## Target Users

**Primary:** Middle and high school students (grades 8–12) in the United States
who are planning to apply to college. The app is designed to be used
independently, without requiring a counselor or parent to drive the experience.
Students can begin as early as 8th grade and use the app through their senior
year.

**V1 scope:** Students only. Parent and counselor views are out of scope for
the initial build.

## Key Constraints

- **Technology:** Uses the existing docker-node-template stack (Express +
  React + TypeScript + PostgreSQL + Prisma + Docker Swarm).
- **AI:** Claude API (Anthropic) powers the conversational chat layer. The
  backend calls the Claude API; the frontend presents a persistent chat
  interface.
- **Monetization:** Free to use — no paywall, subscription, or premium tier in
  this version.
- **Team:** AI-assisted development (CLASI process); future contributors will
  pick up modules documented but not implemented in v1.
- **Initial build focus:** Onboarding, student profile, interest questionnaire,
  and 4-year academic plan. All other feature modules are designed and
  documented for future implementation.

## High-Level Requirements

### In Scope — Initial Build (v1)

1. **Student onboarding & account creation**
   - Sign-up flow with email/password authentication
   - Students enter basic profile: name, current grade, high school, state

2. **Interest & goals questionnaire**
   - Multi-step guided questionnaire covering academic interests, career
     goals, extracurricular activities, and college preferences (location,
     size, type)
   - Results stored on the student's profile and used to drive future
     recommendations

3. **Academic profile**
   - Students record current and planned courses, GPA, and any test scores
     they have
   - App warns if a student's course load appears imbalanced or if they
     are missing recommended courses for their goals

4. **4-year academic plan**
   - AI-assisted generation of a personalized 4-year course plan based on
     the student's goals, interests, and current grade
   - Student can view, edit, and save the plan

5. **Conversational AI (Claude)**
   - Persistent chat interface accessible from any page
   - Claude has access to the student's profile context and can answer
     questions, explain recommendations, and provide guidance in plain language

### Designed for Future Implementation

The following modules are to be designed, documented (user stories, data
model, API contracts), and scaffolded in v1 — but full implementation is
deferred to future contributors:

- **Test prep guidance** — SAT/ACT/AP recommendations, study schedules,
  registration reminders
- **College & major discovery** — Guided questionnaire, college list
  (reach/target/safety), major matching
- **Essay writing support** — Timeline, structured guidance, Why This School
  assistant
- **Letters of recommendation tracker** — Checklist, teacher relationship
  building reminders, brag packet guide
- **Deadline & portal management** — Unified application deadline calendar,
  portal check-in reminders
- **Scholarship & financial aid matching** — Profile-matched scholarship
  recommendations, FAFSA/CSS reminders
- **Enrollment decision support** — Pros/cons framework, honors program
  surfacing

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Backend API | Express 4 + TypeScript (Node.js 20 LTS) |
| Frontend SPA | Vite + React + TypeScript |
| Database | PostgreSQL 16 Alpine via Prisma ORM |
| AI | Claude API (Anthropic) — `claude-sonnet-4-6` |
| Auth | Express session + Passport.js (local strategy) |
| Containerization | Docker Compose (dev), Docker Swarm (prod) |
| Secrets | SOPS + age at rest; Docker Swarm secrets at runtime |
| Reverse proxy | Caddy (`collegenavigator.jtlapp.net`) |

All API routes prefixed with `/api`. PostgreSQL is the single data store — no
Redis or MongoDB.

## Sprint Roadmap

| Sprint | Focus |
|--------|-------|
| **Sprint 1** | Foundation: auth (signup/login/logout), student profile CRUD, database schema for profile + questionnaire |
| **Sprint 2** | Interest & goals questionnaire: multi-step flow, persistence, initial recommendation seed |
| **Sprint 3** | 4-year academic plan: plan generation with Claude, display, edit |
| **Sprint 4** | Conversational AI: Claude chat interface, profile context injection, session persistence |
| **Sprint 5** | Future module scaffolding: data models, API contracts, and UI stubs for all deferred features |

## Out of Scope

- Parent and counselor accounts or dashboards (v1 is student-only)
- Paid features, subscriptions, or any monetization mechanism
- Real-time college admissions data feeds or integrations with Common App,
  Coalition App, or any third-party application portal
- Actual letter of recommendation submission or email delivery
- Direct integration with high school SIS (student information systems)
- Mobile native apps (iOS/Android) — web-only in v1
- Multi-language support
- FERPA compliance infrastructure (students are assumed to be using personal
  accounts; no school district data sharing agreements)
