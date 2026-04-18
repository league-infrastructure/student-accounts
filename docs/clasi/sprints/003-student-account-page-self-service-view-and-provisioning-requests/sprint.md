---
id: "003"
title: "Student Account Page — Self-Service View and Provisioning Requests"
status: roadmap
branch: sprint/003-student-account-page-self-service-view-and-provisioning-requests
use-cases: [UC-007, UC-010, UC-011]
---

# Sprint 003: Student Account Page — Self-Service View and Provisioning Requests

## Goal

Deliver the student-facing account page: profile, login management, service
status, and provisioning requests. This is the first sprint that produces a
working screen a real student can use.

## Use Cases Delivered

- **UC-007** — Student self-service provisioning request: request League
  email, or League email + Claude seat together; Claude seat request
  blocked until League email exists or is requested.
- **UC-010** — Student adds their own Login (Google or GitHub OAuth flow).
- **UC-011** — Student removes their own Login (blocked if only one remains).

## Scope

- Student account page: four sections — Profile, Logins, Services, Help.
- Profile section: display name, primary email, cohort (read-only).
- Logins section: list connected providers; Add and Remove buttons with
  enforced "at least one Login" constraint.
- Services section: show status of League Workspace account, Claude Team
  seat, Pike13 link. "Request" buttons per service, with Claude seat
  option disabled until League email is requested or active.
- ProvisioningRequest creation and display (pending/approved/rejected).
- Audit events for Login add, Login remove, ProvisioningRequest creation.
- All views scoped strictly to the signed-in student; no cross-user data.
- Role guard: this page is only accessible to role=student.

## Dependencies

- Sprint 001 (data model, audit service).
- Sprint 002 (authentication — students must be able to sign in).

## Non-Goals

- No actual provisioning (that is Sprint 004 for Workspace and Sprint 005 for
  Claude Team).
- No administrator approval UI for provisioning requests (Sprint 005 or later).
- No Pike13 write-back from Login add (Sprint 006).
- No merge suggestion triggering from Login add (Sprint 007).

## Rationale

This is the earliest sprint that produces something a real user can touch.
Delivering student self-service in Sprint 003 also defines the
ProvisioningRequest workflow that administrators will act on in later sprints,
so the data model path is exercised early.

## Tickets

_(To be created when this sprint enters Detail Mode.)_
