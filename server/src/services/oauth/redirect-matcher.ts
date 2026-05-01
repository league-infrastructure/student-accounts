/**
 * redirect-matcher — pure URI matching for OAuth redirect_uri validation.
 *
 * Implements two match rules (Sprint 019 ticket 002):
 *
 * 1. **Exact match**: `candidate` equals any string in `registered` exactly.
 *
 * 2. **Localhost-any-port match**: if the candidate's hostname is a loopback
 *    address (`localhost`, `127.0.0.1`, or `[::1]`) AND the same scheme AND
 *    pathname, it matches any registered entry that also has a loopback
 *    hostname with the same scheme and pathname — regardless of port.
 *
 *    The loopback equivalence class is {localhost, 127.0.0.1, [::1]}.
 *    Any registered loopback host matches any candidate loopback host as
 *    long as scheme and path match. This lets developers register
 *    `http://localhost:8080/callback` and use `http://localhost:5555/callback`
 *    without re-registering.
 *
 * Security rules enforced here:
 * - Hostname comparison is exact URL-parsed `.hostname` — not substring/endsWith.
 *   `http://localhostfake.com/cb` does NOT match.
 * - Path comparison is exact `url.pathname` (no prefix matching, no trailing-slash
 *   tolerance). `http://localhost:5555/other` does NOT match a `/cb` registration.
 * - Schemes must match exactly (`https:` vs `http:` is a mismatch).
 * - Malformed candidate URLs return `false` (never throw).
 * - Query strings and fragments on the candidate are IGNORED for matching.
 *   The check is: same scheme + same loopback-class hostname + same pathname.
 */

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]']);

function isLoopback(hostname: string): boolean {
  return LOOPBACK_HOSTNAMES.has(hostname);
}

/**
 * Match a candidate redirect_uri against a list of registered URIs.
 *
 * @param registered - The list of registered redirect_uris for the client.
 * @param candidate  - The redirect_uri supplied in the OAuth request.
 * @returns `true` if the candidate is allowed; `false` otherwise.
 */
export function matchesRedirectUri(registered: string[], candidate: string): boolean {
  if (!candidate) return false;

  // --- Rule 1: Exact string match ---
  if (registered.includes(candidate)) return true;

  // --- Rule 2: Localhost-any-port ---
  // Parse candidate; return false on malformed input instead of throwing.
  let parsedCandidate: URL;
  try {
    parsedCandidate = new URL(candidate);
  } catch {
    return false;
  }

  // Only apply the localhost rule if the candidate is a loopback host.
  if (!isLoopback(parsedCandidate.hostname)) return false;

  const candidateScheme = parsedCandidate.protocol; // includes trailing ':'
  const candidatePath = parsedCandidate.pathname;

  for (const reg of registered) {
    let parsedReg: URL;
    try {
      parsedReg = new URL(reg);
    } catch {
      continue; // skip malformed registered entries
    }

    if (
      isLoopback(parsedReg.hostname) &&
      parsedReg.protocol === candidateScheme &&
      parsedReg.pathname === candidatePath
    ) {
      return true;
    }
  }

  return false;
}
