---
id: "002"
title: "Authentication — Social Sign-In and Staff OU Detection"
status: roadmap
branch: sprint/002-authentication-social-sign-in-and-staff-ou-detection
use-cases: [UC-001, UC-002, UC-003]
---

# Sprint 002: Authentication — Social Sign-In and Staff OU Detection

## Goal

Implement OAuth sign-in for both Google and GitHub, including automatic user
creation on first login and staff role assignment via Google Workspace OU
membership. After this sprint, real users can sign in.

## Use Cases Delivered

- **UC-001** — Social sign-in via Google: new user created on first login.
- **UC-002** — Social sign-in via GitHub: new user created on first login.
- **UC-003** — Staff sign-in: role=staff assigned by reading the actor's OU
  membership from the Google Admin SDK at sign-in time.

## Scope

- Google OAuth 2.0 callback: create `Login` (provider=google) and `User` if
  none matches; establish session.
- GitHub OAuth callback: create `Login` (provider=github) and `User`; store
  GitHub username on the Login record.
- Staff detection: call Google Admin SDK on sign-in to check OU membership;
  assign role=staff if the account is under the League staff OU.
- Session management: cookie-based sessions, role embedded in session.
- Error pages for OAuth failures and denied consent.
- Audit events for user creation (UC-021).
- The merge similarity check stub: a no-op hook called on user creation,
  to be filled in by Sprint 007. It must be called here so the wiring exists.
- Redirect to correct landing page by role: student account page (stub),
  staff directory (stub), admin dashboard (stub) — placeholders are
  sufficient.

## Dependencies

- Sprint 001 (data model, audit service, session infrastructure).
- External: Google OAuth app credentials; GitHub OAuth app credentials;
  Google Admin SDK service account with domain-wide delegation (for OU read).

## Non-Goals

- No student account page content (Sprint 003).
- No cohort management or Workspace provisioning (Sprint 004).
- No merge queue logic (Sprint 007) — only the call site stub.
- Administrator role assignment is deferred; for now admins are identified
  by manual DB flag or environment config.

## Rationale

Nothing in the application is accessible without sign-in. Delivering auth
in Sprint 002 means Sprint 003 onwards can build real, sign-in-gated UI
against real user records. Staff OU detection is bundled here because it
reuses the same Google Admin SDK call made at sign-in and adds minimal
complexity to the callback.

## Tickets

_(To be created when this sprint enters Detail Mode.)_
