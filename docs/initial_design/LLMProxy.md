# Claude Access Proxy — Project Design Document

## Overview

A lightweight web application that lets an administrator provision time-limited API access to Claude for cohorts of students. Students authenticate with a passphrase, claim a personal token, and use that token to call Claude via a proxy endpoint — from the terminal (Claude Code) or from VS Code.

---

## User Roles

### Administrator
- Creates and manages **cohorts** (named groups of students)
- Sets a **passphrase** for each cohort (distributed out-of-band, e.g. in a class meeting)
- Sets an **expiration date/time** for each cohort — all tokens issued under that cohort stop working at expiry
- Views usage per cohort or per student (basic spend/request counts)

### Student
- Visits the web app
- Enters the cohort passphrase to register an account
- Receives a personal **API token** and the **proxy endpoint URL**
- Uses those credentials to connect Claude Code or the VS Code extension to Claude via the proxy

---

## Core Flows

### Cohort Creation (Admin)
1. Admin logs in to the admin UI
2. Creates a cohort: name, passphrase, expiration datetime
3. System stores the cohort; passphrase is hashed before storage
4. Admin shares the passphrase with students in a meeting

### Student Registration
1. Student visits the app URL
2. Enters a username/email and the cohort passphrase
3. If passphrase matches an active cohort, an account is created
4. A personal token is generated and displayed **once**
5. Student is shown setup instructions: endpoint URL + token

### API Access (Runtime)
1. Student's tool (Claude Code, VS Code extension) sends requests to the proxy endpoint with their token in the `Authorization` header
2. Proxy validates the token: exists, not revoked, cohort not expired
3. Proxy forwards the request to Anthropic's API using the real API key (never exposed to students)
4. Response is returned to the student's tool

### Token Expiry
- Cohort expiration is checked on every proxied request
- Expired tokens receive a `401` with a clear message
- Students cannot re-register with an expired cohort's passphrase

---

## Data Model (Sketch)

**Cohort**
- id, name
- passphrase_hash
- expires_at
- created_at

**User**
- id, cohort_id
- username / email
- token_hash (the issued token is hashed; the plain token is shown once)
- created_at
- revoked (bool)

**RequestLog** (optional but useful for spend tracking)
- id, user_id
- timestamp, model, input_tokens, output_tokens

---

## What This Is Not

This is intentionally minimal. It does not:
- Support multiple LLM providers (Anthropic only)
- Offer per-student rate limits or spend caps (cohort expiry is the budget control)
- Handle billing or payment
- Require students to have an Anthropic account

---

## Stack (Proposed)

- **Node.js / Express** — HTTP server and proxy layer
- **SQLite** — Simple embedded DB; no infra to manage
- **Server-rendered UI or minimal React** — Admin dashboard and student registration page
- Deployed as a single process (e.g. a VPS, Railway, Render)

---

## Open Questions

1. Should the admin UI require a separate hard-coded password, or should there be an admin user in the DB?
2. Do we want per-student usage logs, or just cohort-level aggregates?
3. Should students be able to regenerate their token if they lose it (requires re-showing it after auth)?
4. Do we want a hard per-cohort request cap in addition to time expiry?
