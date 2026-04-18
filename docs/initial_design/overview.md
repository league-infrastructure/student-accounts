---
title: User Account Management — Project Overview
status: active
---

# User Account Management

The League runs a programming school for students in grades 2–12. Each student
requires accounts in several third-party systems: Google Workspace (student
email on `@students.jointheleague.org`), Claude Team (AI tooling), GitHub
(version control), and Pike13 (class management). Today those systems are
managed independently. This application brings them together.

## What It Does

A single canonical User record represents each person. That record links to
whatever external accounts the person has been given. Administrators provision,
suspend, and remove those accounts from one place — individually or by cohort.
Students sign in via social login (Google or GitHub), see the state of their
own account, and can request provisioning. Staff sign in with their League
Google account and get a read-only view of student data.

Key capabilities:

- Social sign-in (Google, GitHub) — no passwords stored by this app.
- Administrator-driven provisioning of League Workspace accounts and Claude
  Team seats, per student or per cohort.
- Cohorts map to Google Workspace Organizational Units; bulk operations act on
  an entire cohort at once.
- LLM-assisted (Claude Haiku) duplicate detection with an administrator merge
  queue — no auto-merges.
- Write-back of League email address and GitHub handle to Pike13 custom fields
  so parents see them.
- Full audit log of every administrative action.

## What It Is Not

This app does not manage Pike13 enrollments, billing, or class scheduling. It
does not create staff accounts (`@jointheleague.org` addresses are provisioned
outside this system). It does not manage GitHub organization membership. It
does not touch Pike13 accounts at deprovisioning time.

## Primary Stakeholders

- **Administrators** — provision, suspend, remove, merge, manage cohorts.
- **Students** — self-service account view and provisioning requests.
- **Staff** — read-only directory scoped to their org-wide student population.

## Technology Direction

Web application backed by the League's existing Google Workspace and the
Claude Team API. Authentication is entirely delegated to Google and GitHub
OAuth. See `docs/clasi/design/specification.md` for full detail.
