---
id: "002"
title: "redirect-matcher pure module with localhost-any-port unit tests"
status: todo
use-cases:
  - SUC-019-004
depends-on: []
github-issue: ""
todo: "plan-single-sign-on-oauth-provider-migration.md"
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# redirect-matcher pure module with localhost-any-port unit tests

## Description

Create `server/src/services/oauth/redirect-matcher.ts` exporting a pure
function:

```ts
export function matchesRedirectUri(
  registered: string[],
  candidate: string,
): boolean
```

No I/O, no DB, no logging — just URL parsing and comparison. Both
`/oauth/authorize` (ticket 005) and `POST /oauth/authorize/consent`
(ticket 006) call this. Centralizing the rule keeps it testable in
isolation. See `architecture-update.md` § "New Modules (Server)" and
the SUC-019-004 acceptance criteria.

**Match rule:**

1. **Exact match.** If `candidate` exactly equals any entry in
   `registered` (string equality), return `true`.
2. **Localhost-any-port.** Otherwise, parse `candidate` with `new URL()`.
   If the candidate's hostname (the host portion only, exact equality)
   is one of `localhost`, `127.0.0.1`, `[::1]` (IPv6 loopback), check
   each `registered` entry: parse it, and if its hostname is one of
   that same set AND its pathname equals the candidate's pathname,
   return `true` regardless of port.
3. Otherwise, return `false`.

**Critical security rules** (per `architecture-update.md` § Risks):

- Use the parsed URL's hostname for the localhost check — exact host
  equality, not substring or `endsWith`. `http://localhostfake.com/cb`
  must NOT match.
- Path comparison must be exact (`url.pathname`), not prefix.
- Reject malformed candidate URLs (return `false`, never throw).
- Treat `localhost`, `127.0.0.1`, and `[::1]` as members of one
  loopback equivalence class — any registered loopback host matches a
  candidate loopback host as long as paths match. Document this in the
  module's JSDoc.
- Schemes must match exactly (don't let `https://` candidate match an
  `http://` registered entry, even on localhost).

## Acceptance Criteria

- [ ] `server/src/services/oauth/redirect-matcher.ts` exports `matchesRedirectUri(registered, candidate)`.
- [ ] Function is pure (no imports of `prisma`, `fetch`, `fs`, etc.).
- [ ] JSDoc documents the loopback-equivalence rule and the localhost-any-port rule.
- [ ] Returns `false` (not throws) on malformed candidate URLs.
- [ ] All 15+ unit tests pass.

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: `server/src/services/oauth/redirect-matcher.test.ts` covering at minimum:
  - Exact match against single registered entry.
  - Exact match against one of multiple registered entries.
  - No match when registered is empty.
  - Localhost-any-port: registered `http://localhost:8080/cb` matches candidate `http://localhost:5555/cb`.
  - 127.0.0.1 vs localhost cross-match (registered `http://localhost:8080/cb` matches candidate `http://127.0.0.1:9000/cb`).
  - IPv6 loopback `http://[::1]:5555/cb` matches registered `http://localhost:8080/cb`.
  - Path mismatch on localhost → no match (`http://localhost:5555/other` vs registered `http://localhost:8080/cb`).
  - Non-localhost different port → no match (`https://example.com:5555/cb` vs registered `https://example.com/cb`).
  - **Attack: `http://localhostfake.com/cb` vs registered `http://localhost:8080/cb` → no match.**
  - **Attack: `http://evil.com/cb#localhost` vs registered `http://localhost:8080/cb` → no match.**
  - **Attack: `http://localhost.evil.com/cb` vs registered `http://localhost:8080/cb` → no match.**
  - Scheme mismatch → no match (`https://localhost:5555/cb` vs registered `http://localhost:8080/cb`).
  - Malformed candidate (`"not a url"`) → no match (does not throw).
  - Empty candidate → no match.
  - Trailing-slash path difference → no match (paths compared exactly).
  - Query string on candidate is ignored for path comparison (or rejected — pick one and document).
- **Verification command**: `npm run test:server -- redirect-matcher`
