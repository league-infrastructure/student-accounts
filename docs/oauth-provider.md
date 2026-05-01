# OAuth 2.0 Provider — Integrator Guide

This application acts as an OAuth 2.0 authorization server (identity provider).
Third-party applications can authenticate users and read basic profile data
through the authorization-code flow with PKCE (RFC 7636).

---

## 1. Overview

### When to use the authorization-code flow

Use this flow when your application needs to act **on behalf of a human user**:

- Identify who the user is (name, email, role)
- Ask the user for consent before accessing their data
- Operate as a web or native app that redirects the browser

For server-to-server access where no user is involved, use the
`client_credentials` grant instead (see the `users:read` scope for
read-only access without user context).

### High-level flow

```
 Browser                  Your App               League App
   │                         │                       │
   │  Visit your app         │                       │
   │──────────────────────→  │                       │
   │                         │  Build PKCE pair      │
   │                         │  Redirect to /oauth/authorize
   │  302 → /oauth/authorize │──────────────────────→│
   │──────────────────────────────────────────────→  │
   │                         │                       │  User logs in
   │                         │                       │  (if not already)
   │                         │                       │  Consent screen
   │                         │                       │  User clicks Allow
   │  302 → redirect_uri?code=...&state=...          │
   │←────────────────────────────────────────────────│
   │  Follow redirect        │                       │
   │──────────────────────→  │                       │
   │                         │  POST /oauth/token    │
   │                         │──────────────────────→│
   │                         │  { access_token, refresh_token, ... }
   │                         │←──────────────────────│
   │                         │  GET /oauth/userinfo  │
   │                         │──────────────────────→│
   │                         │  { sub, email, name, role }
   │                         │←──────────────────────│
```

---

## 2. Registering a Client

Client registration is done through the admin UI by an administrator.

1. Sign in with an ADMIN account.
2. Navigate to **Admin → OAuth Clients** (`/admin/oauth-clients`).
3. Click **New client** and fill in:

   | Field | Description |
   |-------|-------------|
   | `name` | Short display name shown on the consent screen (e.g. "Gradebook App") |
   | `description` | One-sentence description shown to users on the consent screen |
   | `redirect_uris` | One URI per line. Exact-match required (with localhost exception — see §8) |
   | `allowed_scopes` | Space-separated scopes your client is allowed to request (e.g. `profile users:read`) |

4. Click **Save**. The page shows the **client secret exactly once**. Copy it now — the app stores only a hash and will never show the plaintext again.

You receive a `client_id` (numeric string, shown on the list page) and the one-time `client_secret`.

---

## 3. Authorization-Code + PKCE Flow

### Step 1 — Generate a PKCE pair

```bash
# code_verifier: 43–128 character base64url string (no padding)
CODE_VERIFIER=$(openssl rand -base64 96 | tr -d '/+=' | head -c 96)

# code_challenge: base64url(SHA-256(verifier)), no padding
CODE_CHALLENGE=$(printf '%s' "$CODE_VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=')
```

### Step 2 — Send the user to the authorization endpoint

Build the URL and redirect the browser:

```
GET https://<host>/oauth/authorize
  ?response_type=code
  &client_id=<your_client_id>
  &redirect_uri=<your_registered_redirect_uri>
  &scope=profile
  &state=<random_opaque_value>
  &code_challenge=<CODE_CHALLENGE>
  &code_challenge_method=S256
```

All parameters are required. `scope` is a space-separated list.

If the user is not logged in, they are redirected to the login page and
returned here after signing in. They then see the consent screen. After
clicking **Allow**, the browser is redirected to your `redirect_uri`.

### Step 3 — Receive the code

Your `redirect_uri` receives:

```
<redirect_uri>?code=<authorization_code>&state=<your_state>
```

**ALWAYS verify that `state` matches what you sent.** This is your CSRF
defense — an attacker who tricks a user into visiting your callback with a
code they did not authorize would fail the `state` check.

### Step 4 — Exchange the code for tokens

```bash
curl -X POST https://<host>/oauth/token \
  -u "<client_id>:<client_secret>" \
  -d "grant_type=authorization_code" \
  -d "code=<code>" \
  -d "redirect_uri=<your_registered_redirect_uri>" \
  -d "code_verifier=<CODE_VERIFIER>"
```

Alternatively, send `client_id` and `client_secret` as form fields instead
of HTTP Basic auth.

Successful response:

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "...",
  "scope": "profile"
}
```

---

## 4. Calling /oauth/userinfo

```bash
curl https://<host>/oauth/userinfo \
  -H "Authorization: Bearer <access_token>"
```

Response:

```json
{
  "sub": "42",
  "email": "alice@example.com",
  "name": "Alice Smith",
  "role": "USER"
}
```

| Field | Description |
|-------|-------------|
| `sub` | Stable subject identifier (string form of the user's numeric ID) |
| `email` | Primary email address |
| `name` | Display name |
| `role` | Application role: `USER`, `staff`, or `ADMIN` |

Required scope: `profile`.

---

## 5. Refreshing Tokens

Access tokens expire after 1 hour. Use the refresh token to get a new pair
without prompting the user again:

```bash
curl -X POST https://<host>/oauth/token \
  -u "<client_id>:<client_secret>" \
  -d "grant_type=refresh_token" \
  -d "refresh_token=<refresh_token>"
```

Response shape is identical to the authorization-code response:

```json
{
  "access_token": "...",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "...",
  "scope": "profile"
}
```

**Important:** The old refresh token is immediately invalidated after rotation.
Store the new one. If you accidentally replay an old refresh token, the
**entire token chain is revoked** as a security measure — the user must
re-authorize.

---

## 6. Scopes

| Scope | What it grants |
|-------|---------------|
| `profile` | Call `GET /oauth/userinfo` to read `sub`, `email`, `name`, `role` |
| `users:read` | Call `GET /v1/users` and `GET /v1/users/:id` to read the user directory |

Request only the scopes your application actually needs. Users see each
requested scope on the consent screen.

---

## 7. Token Lifetimes

| Token | Lifetime | Notes |
|-------|---------|-------|
| Authorization code | 10 minutes | Single-use; replaying returns `invalid_grant` |
| Access token | 1 hour | Bearer token; revoked when user is deleted |
| Refresh token | 30 days | Rotated on every use; replay revokes full chain |

---

## 8. Redirect-URI Matching Rule

Redirect URIs are validated against the list registered for your client.

**Default rule:** Exact string match.

**Localhost exception:** For loopback addresses (`localhost`, `127.0.0.1`,
`[::1]`), the port number is ignored. This lets you test on any local port
without registering each one individually.

| Registered | Candidate | Result |
|------------|-----------|--------|
| `http://localhost:8080/cb` | `http://localhost:8080/cb` | Accepted (exact) |
| `http://localhost:8080/cb` | `http://localhost:5555/cb` | Accepted (localhost any-port) |
| `http://localhost:8080/cb` | `http://localhost:5555/different` | Rejected (path mismatch) |
| `http://localhost:8080/cb` | `http://localhostfake.com/cb` | Rejected (not loopback) |
| `http://127.0.0.1:8080/cb` | `http://localhost:9000/cb` | Accepted (cross-loopback + any-port) |
| `https://myapp.example.com/cb` | `https://myapp.example.com/cb` | Accepted (exact) |
| `https://myapp.example.com/cb` | `https://myapp.example.com:8443/cb` | Rejected (port differs on non-loopback) |

**Security note:** If `redirect_uri` does not match, the authorization
endpoint renders an error directly — it does NOT redirect to the
unvalidated URI. Never accept an authorization code when the callback URL
was not validated.

---

## 9. Error Responses

All error responses from `/oauth/token` and `/oauth/userinfo` follow the
OAuth 2.0 spec (`application/json` body):

```json
{ "error": "<code>", "error_description": "<human-readable message>" }
```

| HTTP status | Error code | Meaning |
|-------------|-----------|---------|
| 400 | `invalid_request` | Missing required parameter or malformed request |
| 400 | `invalid_grant` | Code/verifier mismatch, expired code, replayed code, mismatched `redirect_uri` |
| 400 | `invalid_scope` | Requested scope is not allowed for this client |
| 400 | `unsupported_grant_type` | `grant_type` is not `authorization_code`, `refresh_token`, or `client_credentials` |
| 401 | `invalid_client` | Unknown client, wrong secret, or disabled client |
| 403 | `insufficient_scope` | Token does not have the required scope for this resource |
| 404 | — | Token is valid but `user_id` is null (client-credentials token used on a user endpoint) or user has been deleted |

From `GET /oauth/authorize`, the `error=access_denied` redirect is sent
to your `redirect_uri` when the user clicks Deny.

---

## 10. Working Test Client

The script below walks through the full flow against a local dev server.
It requires `bash`, `curl`, `openssl`, and Python 3 (for the HTTP server).

Save as `docs/oauth-provider/test-client.sh` and run:

```bash
bash docs/oauth-provider/test-client.sh
```

```bash
#!/usr/bin/env bash
# OAuth 2.0 authorization-code + PKCE test client
# Targets the dev server at http://localhost:5201 (Vite proxy → Express).
#
# Requirements: bash, curl, openssl, python3
# Usage: bash docs/oauth-provider/test-client.sh
#
# Before running:
#   1. Start the dev server: npm run dev
#   2. Log in as admin and create an OAuth client at /admin/oauth-clients
#      with redirect_uri = http://localhost:9988/callback
#      and allowed_scopes = profile users:read
#   3. Copy the client_id and client_secret into the variables below.

set -euo pipefail

HOST="http://localhost:5201"
CLIENT_ID="${OAUTH_CLIENT_ID:-}"
CLIENT_SECRET="${OAUTH_CLIENT_SECRET:-}"

if [[ -z "$CLIENT_ID" || -z "$CLIENT_SECRET" ]]; then
  echo ""
  echo "  Set environment variables before running:"
  echo "    export OAUTH_CLIENT_ID=<your client id>"
  echo "    export OAUTH_CLIENT_SECRET=<your client secret>"
  echo ""
  exit 1
fi

REDIRECT_URI="http://localhost:9988/callback"
STATE=$(openssl rand -hex 16)

# 1. Generate PKCE pair
CODE_VERIFIER=$(openssl rand -base64 96 | tr -d '/+=' | head -c 96)
CODE_CHALLENGE=$(printf '%s' "$CODE_VERIFIER" | openssl dgst -sha256 -binary | openssl base64 | tr '+/' '-_' | tr -d '=')

echo ""
echo "=== Step 1: Open this URL in your browser ==="
AUTHORIZE_URL="${HOST}/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=$(python3 -c "import urllib.parse,sys; print(urllib.parse.quote(sys.argv[1],safe='')" "$REDIRECT_URI")&scope=profile&state=${STATE}&code_challenge=${CODE_CHALLENGE}&code_challenge_method=S256"
echo "$AUTHORIZE_URL"
echo ""

# 2. Catch the callback on a one-shot local HTTP server
echo "=== Step 2: Waiting for browser callback on $REDIRECT_URI ==="
CODE=$(python3 - "$REDIRECT_URI" <<'PYEOF'
import sys, http.server, urllib.parse

redirect_uri = sys.argv[1]
port = int(urllib.parse.urlparse(redirect_uri).port)

class Handler(http.server.BaseHTTPRequestHandler):
    def log_message(self, *args): pass
    def do_GET(self):
        qs = urllib.parse.parse_qs(urllib.parse.urlparse(self.path).query)
        code = qs.get('code', [None])[0]
        self.send_response(200)
        self.send_header('Content-Type', 'text/html')
        self.end_headers()
        self.wfile.write(b'<h1>Authorized! You can close this tab.</h1>')
        self.server._code = code
        # Signal the server to stop after one request
        import threading; threading.Thread(target=self.server.shutdown).start()

srv = http.server.HTTPServer(('127.0.0.1', port), Handler)
srv._code = None
srv.serve_forever()
print(srv._code)
PYEOF
)

if [[ -z "$CODE" ]]; then
  echo "ERROR: no code received from browser callback"
  exit 1
fi
echo "Received code: ${CODE:0:8}..."

# 3. Verify state (in a real app you'd compare to your session-stored state)
echo ""
echo "=== Step 3: Exchanging code for tokens ==="
TOKEN_RESPONSE=$(curl -sf -X POST "${HOST}/oauth/token" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  --data-urlencode "grant_type=authorization_code" \
  --data-urlencode "code=${CODE}" \
  --data-urlencode "redirect_uri=${REDIRECT_URI}" \
  --data-urlencode "code_verifier=${CODE_VERIFIER}")

echo "$TOKEN_RESPONSE" | python3 -m json.tool

ACCESS_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['access_token'])")
REFRESH_TOKEN=$(echo "$TOKEN_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['refresh_token'])")

# 4. Call userinfo
echo ""
echo "=== Step 4: GET /oauth/userinfo ==="
curl -sf "${HOST}/oauth/userinfo" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" | python3 -m json.tool

# 5. Rotate the refresh token
echo ""
echo "=== Step 5: Rotating refresh token ==="
ROTATE_RESPONSE=$(curl -sf -X POST "${HOST}/oauth/token" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=${REFRESH_TOKEN}")

echo "$ROTATE_RESPONSE" | python3 -m json.tool
NEW_REFRESH=$(echo "$ROTATE_RESPONSE" | python3 -c "import json,sys; d=json.load(sys.stdin); print(d['refresh_token'])")
echo "New refresh token: ${NEW_REFRESH:0:8}..."

# 6. Attempt to replay the original refresh token (must fail)
echo ""
echo "=== Step 6: Replay old refresh token (expect 400 invalid_grant) ==="
HTTP_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "${HOST}/oauth/token" \
  -u "${CLIENT_ID}:${CLIENT_SECRET}" \
  --data-urlencode "grant_type=refresh_token" \
  --data-urlencode "refresh_token=${REFRESH_TOKEN}")
echo "HTTP status: ${HTTP_STATUS} (expected: 400)"

echo ""
echo "=== All steps complete ==="
```

---

## Cross-references

- [docs/testing.md](testing.md) — Test strategy for the project
- Admin panel: `/admin/oauth-clients` — Client management UI
