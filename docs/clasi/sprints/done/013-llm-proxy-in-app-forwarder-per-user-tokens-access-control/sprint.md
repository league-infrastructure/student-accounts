---
id: '013'
title: "LLM proxy in-app \u2014 forwarder + per-user tokens + access control"
status: done
branch: sprint/013-llm-proxy-in-app-forwarder-per-user-tokens-access-control
use-cases:
- SUC-013-001
- SUC-013-002
- SUC-013-003
- SUC-013-004
- SUC-013-005
- SUC-013-006
- SUC-013-007
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 013: LLM proxy in-app

Build the LLM proxy **inside this Node application** — not a separate
service. Full design lives in
[`docs/initial_design/LLMProxy.md`](../../../initial_design/LLMProxy.md);
this sprint scopes the minimal viable build.

Rationale: the proxy is small (a handful of routes), its audience is
small (students doing demos / light projects), and the access-control
surfaces already live here. Heavy API users get real Anthropic access
through their own account — this proxy is a classroom convenience.

Depends on Sprint 012 for group-level bulk toggle.

## Goals

1. Students with access can call Claude via a bearer-token-authed
   forwarder route hosted in this app.
2. Admins can grant/revoke access per user, per cohort, per app-level
   group — with per-grant expiration and token-usage cap.
3. Students see their token, endpoint URL, usage, and expiry on their
   `/account` page with setup snippets.

## Scope

### In Scope

**Proxy surface (forwarder, hot path)**

- Small route group under `/proxy/v1/*` (exact shape governed by
  what Claude Code / VS Code need — see design doc).
- Bearer-token validation against the new `LlmProxyToken` table:
  hash lookup, expiration check, quota check.
- Forwards request to Anthropic using a server-side key, returns the
  response untouched.
- Usage accounting: persist tokens spent + request count per call.

**Model**

- `LlmProxyToken`: user_id FK, token_hash, expires_at, token_limit,
  tokens_used, request_count, granted_by, granted_at, revoked_at,
  (optional) cohort_id / group_id for bulk origin tracking.
- Audit events on grant, revoke, quota change.

**Management surfaces (already-existing pages)**

- Student `/account` page: new "LLM Proxy" section — endpoint URL,
  token (with Copy button), setup snippets, remaining quota, expiry.
  "Not enabled" state when access is absent.
- Admin user detail page: per-user grant/revoke toggle with expiration
  and token cap inputs.
- Cohort and Group detail pages: bulk grant/revoke — flip every
  eligible member on/off in one transaction.

### Out of Scope

- Usage dashboards and aggregate reporting — v1 exposes remaining
  quota only; richer reporting lands later.
- Multi-provider support (OpenAI, etc.) — Anthropic only.
- Self-service token rotation — admins handle revocation.

## Open questions to resolve in detail planning

- Token format: opaque random + hash, or JWT? Opaque is simpler and
  matches the design doc's sketch.
- Where does the upstream Anthropic key live — shared org key vs
  per-cohort? Start with one shared org key; revisit if cost
  attribution demands it.
- Quota semantics: hard cut-off or soft warning? Hard cut-off to
  match how students will actually use it.

## TODO references

- `docs/clasi/todo/llm-proxy-integration.md`
- Full design: `docs/initial_design/LLMProxy.md`

## Tickets

(To be populated during detail-phase planning.)
