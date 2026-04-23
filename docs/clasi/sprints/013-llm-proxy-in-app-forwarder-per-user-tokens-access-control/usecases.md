---
status: final
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 013 Use Cases

These sprint-scoped use cases (SUC-013-*) capture the behaviours that
must exist when Sprint 013 closes. They decompose the LLM-proxy
feature described in `docs/initial_design/LLMProxy.md` and the TODO
`docs/clasi/todo/llm-proxy-integration.md`.

---

## SUC-013-001: Admin grants LLM-proxy access to a single user
Parent: UC-LLM-PROXY (new feature surface)

- **Actor**: Admin
- **Preconditions**:
  - A target user exists in the system (active, any role).
  - The admin is authenticated (role=admin) and viewing the user's
    detail page (`/users/:id`).
  - No active (non-revoked, non-expired) `LlmProxyToken` exists for
    this user.
- **Main Flow**:
  1. Admin sees an "LLM Proxy access" card on the user detail page
     with a "Grant access" button, and inputs for expiration (default:
     30 days) and token cap (default: 1,000,000 tokens).
  2. Admin submits the grant form.
  3. Server creates a new `LlmProxyToken` row with a freshly-generated
     opaque token (hashed at rest), sets `expires_at` and
     `token_limit`, records `granted_by=actorId`, and writes a
     `grant_llm_proxy_token` audit event in the same transaction.
  4. Server returns the plaintext token exactly once in the HTTP
     response (the caller is the admin, not the student).
- **Postconditions**:
  - A single active `LlmProxyToken` row exists for the user.
  - The student sees the token on their own `/account` page via the
    student endpoint (which always surfaces the plaintext once at
    grant time via a one-shot field, then only the hash; see
    SUC-013-004).
  - An audit event `grant_llm_proxy_token` is persisted.
- **Acceptance Criteria**:
  - [ ] POST `/admin/users/:id/llm-proxy-token` with `{expiresAt,
        tokenLimit}` returns 201 with `{token, expiresAt, tokenLimit}`
        the first time.
  - [ ] Second grant while an active token exists returns 409 with
        a clear error.
  - [ ] Granting after revocation creates a new row (new token) and
        succeeds.
  - [ ] The plaintext token is never persisted.
  - [ ] `grant_llm_proxy_token` audit event is written.

---

## SUC-013-002: Admin revokes LLM-proxy access for a single user
Parent: UC-LLM-PROXY

- **Actor**: Admin
- **Preconditions**: An active `LlmProxyToken` exists for the user.
- **Main Flow**:
  1. Admin clicks "Revoke access" on the user detail page.
  2. Server sets `revoked_at = now()` on the active token.
  3. Server writes a `revoke_llm_proxy_token` audit event.
- **Postconditions**:
  - The token no longer passes bearer-auth; any subsequent proxy
    request with it returns 401.
  - The user's `/account` "LLM Proxy" section shows "Not enabled".
- **Acceptance Criteria**:
  - [ ] DELETE `/admin/users/:id/llm-proxy-token` returns 204.
  - [ ] Proxy calls with the revoked token return 401.
  - [ ] DELETE on a user with no active token returns 404.

---

## SUC-013-003: Student uses their token against the proxy
Parent: UC-LLM-PROXY

- **Actor**: Student (or their tool — Claude Code / VS Code extension)
- **Preconditions**:
  - The student has a non-revoked, non-expired `LlmProxyToken` whose
    `tokens_used` is strictly less than `token_limit`.
  - `ANTHROPIC_API_KEY` is configured in the server environment.
- **Main Flow**:
  1. The tool sends `POST /proxy/v1/messages` with
     `Authorization: Bearer <token>` and a standard Anthropic
     Messages API body.
  2. The forwarder validates the bearer token (hash lookup + expiry
     + quota check).
  3. The forwarder forwards the request to
     `https://api.anthropic.com/v1/messages` using the server-side
     `ANTHROPIC_API_KEY`, preserving body and `stream` behaviour.
  4. If `stream=true`, the forwarder streams the SSE response bytes
     back to the client unbuffered. Otherwise it returns the JSON.
  5. After the upstream call finishes, the forwarder reads token
     usage from the response (JSON `usage.input_tokens +
     output_tokens`, or accumulated from `message_delta` events for
     streaming) and atomically increments `tokens_used` and
     `request_count`.
- **Postconditions**:
  - `tokens_used` and `request_count` are updated on the token row.
  - The client receives the Anthropic response unchanged.
- **Acceptance Criteria**:
  - [ ] Non-streaming forward returns the upstream JSON body and
        status.
  - [ ] Streaming forward returns SSE bytes with no buffering (the
        first byte is sent before the upstream is fully drained).
  - [ ] `tokens_used` and `request_count` are persisted after a
        non-streaming call.
  - [ ] Streaming calls also persist token usage once the stream
        completes.
  - [ ] Missing `ANTHROPIC_API_KEY` yields 503 with a clear error
        message.

---

## SUC-013-004: Student sees their token and quota on `/account`
Parent: UC-LLM-PROXY

- **Actor**: Student
- **Preconditions**: A `LlmProxyToken` exists (active or not).
- **Main Flow**:
  1. Student loads `/account`.
  2. The page renders a new "LLM Proxy" section with:
     - Endpoint URL (the app's origin + `/proxy/v1`).
     - Token (masked by default, Copy button revealing the stored
       plaintext if the token was just issued in this session; or a
       "Regenerate" hint — see Out of Scope below for rotation).
     - Setup snippets (curl and `ANTHROPIC_BASE_URL` / Claude Code
       env var).
     - Remaining quota (`token_limit - tokens_used`) and expiry.
  3. If no active token exists, the section renders "Not enabled —
     ask an admin to grant access".
- **Postconditions**: None.
- **Acceptance Criteria**:
  - [ ] GET `/api/account/llm-proxy` returns `{enabled: true,
        endpoint, tokensUsed, tokenLimit, expiresAt}` for active
        users and `{enabled: false}` otherwise.
  - [ ] The `/account` page renders the section per the above.
  - [ ] The plaintext token is exposed exactly once per grant
        (returned only by the grant endpoint; not persisted
        decoded).

---

## SUC-013-005: Enforcement — expired or over-quota tokens are rejected
Parent: UC-LLM-PROXY

- **Actor**: System (enforcement, no direct human actor)
- **Preconditions**: A `LlmProxyToken` exists and a client calls the
  proxy with it.
- **Main Flow**:
  1. Forwarder looks up the token by `token_hash`.
  2. If the row is missing or `revoked_at != null` → 401.
  3. If `expires_at < now()` → 401 with "token expired".
  4. If `tokens_used >= token_limit` → 429 with "quota exhausted".
- **Postconditions**:
  - No upstream Anthropic call is made.
  - No usage counters are incremented.
- **Acceptance Criteria**:
  - [ ] Missing / unknown token → 401.
  - [ ] Revoked token → 401.
  - [ ] Expired token → 401 with "expired" in the error body.
  - [ ] Over-quota token → 429.

---

## SUC-013-006: Admin bulk-grants / bulk-revokes across a cohort
Parent: UC-LLM-PROXY + SUC-008 (bulk cohort ops)

- **Actor**: Admin
- **Preconditions**: A cohort exists with N students.
- **Main Flow**:
  1. On the cohort detail page admin clicks "Grant LLM proxy to all"
     (with expiration and token-cap inputs) or "Revoke LLM proxy
     from all".
  2. Server iterates eligible members (active students with no
     active token for grant, or with an active token for revoke)
     inside a single transaction per member — fail-soft loop using
     the shared `bulk-account.shared.ts` helper-like contract, but
     with its own specific handler because this is token provisioning
     not external-account lifecycle.
- **Postconditions**:
  - `succeeded[]` / `failed[]` shape matches the other bulk routes.
  - Each success writes a per-user audit event.
- **Acceptance Criteria**:
  - [ ] POST `/admin/cohorts/:id/llm-proxy/bulk-grant` returns 200
        or 207 with `{succeeded, failed}`.
  - [ ] POST `/admin/cohorts/:id/llm-proxy/bulk-revoke` returns 200
        or 207.
  - [ ] Eligibility correctly skips users who already have an active
        token (grant) or have no active token (revoke).

---

## SUC-013-007: Admin bulk-grants / bulk-revokes across a Group
Parent: UC-LLM-PROXY + SUC-012 (group bulk ops)

- **Actor**: Admin
- **Preconditions**: An app-level Group exists with M members.
- **Main Flow**: Mirrors SUC-013-006 but scoped to Group membership.
- **Postconditions**: Same.
- **Acceptance Criteria**:
  - [ ] POST `/admin/groups/:id/llm-proxy/bulk-grant` returns 200/207.
  - [ ] POST `/admin/groups/:id/llm-proxy/bulk-revoke` returns 200/207.
  - [ ] Bulk routes delegate to the same service method used by the
        cohort bulk routes (no duplicated logic).
