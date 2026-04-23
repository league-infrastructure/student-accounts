---
status: pending
---

# LLM proxy — build it in this app

Build the LLM proxy **inside this application** — not as a separate
service. The full proxy design lives in
[docs/initial_design/LLMProxy.md](../../initial_design/LLMProxy.md);
this TODO scopes what to build here.

## Why inside this app

- The proxy is small — a handful of routes that forward Claude API
  calls, check a token, maybe meter a quota. Not complicated enough
  to warrant its own deployment.
- It's for students only, and there aren't many of them. Usage is
  light — demos and small projects. Heavy users get real Anthropic
  access paid for by their parents.
- Student-accounts already owns identity, cohort/group membership,
  and the surfaces for granting/revoking access. Running the proxy
  here means one database, one deploy, one place for audit events.

So: the Node app serves **both** the proxy forwarder on a small route
group (e.g. `/proxy/v1/*`) **and** the full management UI that decides
who is allowed to call it.

## Scope split inside this app

**Proxy surface (small, hot path)**
- Bearer-token authenticated routes that forward to the Anthropic API.
- Token validation: hash lookup, expiration check, quota check.
- Usage accounting on each call (tokens spent, request count).
- Probably: `/proxy/v1/messages` and whatever shape Claude Code and
  the VS Code extension expect.

**Management surface (already here)**
- Student `/account` page: new LLM Proxy section. When access is
  granted, show the endpoint URL, the personal token with a Copy
  button, setup snippets, and remaining quota / expiry.
- Admin user detail page: per-user grant/revoke toggle, expiration,
  token/quota cap.
- Bulk toggle from the cohort detail page and the app-level groups
  page (see `app-level-groups-for-bulk-provisioning.md`).

## Model sketch

- `LlmProxyToken` per user: token hash, expires_at, token_limit,
  tokens_used, granted_by, granted_at, revoked_at.
- Optional FK to `Group` / `Cohort` so bulk grants/revokes can flip
  every member in one transaction.
- Audit events on grant, revoke, quota change.

## Links

- Full proxy design (endpoints, token format, quotas): [docs/initial_design/LLMProxy.md](../../initial_design/LLMProxy.md)
- App-level groups TODO: `app-level-groups-for-bulk-provisioning.md`
