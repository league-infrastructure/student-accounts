#!/usr/bin/env node
/**
 * Probe the Anthropic Admin API and print a compact OK/FAIL summary.
 *
 * Verifies that ANTHROPIC_ADMIN_API_KEY (or CLAUDE_TEAM_API_KEY as fallback)
 * is valid and the four main organization endpoints are reachable.
 *
 * Usage:
 *   ANTHROPIC_ADMIN_API_KEY=<key> node scripts/probe-anthropic-admin.mjs
 *
 * Or rely on the decrypted .env in the project root:
 *   node scripts/probe-anthropic-admin.mjs
 *
 * Exits 0 if all endpoints return 2xx; exits 1 on any failure.
 *
 * Endpoints probed:
 *   GET /v1/organizations/me
 *   GET /v1/organizations/users?limit=1
 *   GET /v1/organizations/workspaces?limit=10
 *   GET /v1/organizations/invites?limit=1
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Minimal .env parser (no npm deps) — mirrors sanity-check-service-account.mjs
// ---------------------------------------------------------------------------

function loadDotEnv(envPath) {
  if (!fs.existsSync(envPath)) return {};
  const raw = fs.readFileSync(envPath, 'utf-8');
  const result = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eqIdx = trimmed.indexOf('=');
    if (eqIdx === -1) continue;
    const key = trimmed.slice(0, eqIdx).trim();
    let val = trimmed.slice(eqIdx + 1).trim();
    // Strip surrounding quotes
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    result[key] = val;
  }
  return result;
}

// Load .env from project root (if present), but don't override existing env vars
const envVars = loadDotEnv(path.join(projectRoot, '.env'));
for (const [k, v] of Object.entries(envVars)) {
  if (!process.env[k]) {
    process.env[k] = v;
  }
}

// ---------------------------------------------------------------------------
// Resolve API key — prefers ANTHROPIC_ADMIN_API_KEY, falls back to CLAUDE_TEAM_API_KEY
// ---------------------------------------------------------------------------

const API_KEY = process.env.ANTHROPIC_ADMIN_API_KEY ?? process.env.CLAUDE_TEAM_API_KEY ?? '';

if (!API_KEY) {
  console.error('FAIL: Neither ANTHROPIC_ADMIN_API_KEY nor CLAUDE_TEAM_API_KEY is set.');
  process.exit(1);
}

const keySource =
  process.env.ANTHROPIC_ADMIN_API_KEY ? 'ANTHROPIC_ADMIN_API_KEY' : 'CLAUDE_TEAM_API_KEY';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BASE = 'https://api.anthropic.com/v1';
const HEADERS = {
  'x-api-key': API_KEY,
  'anthropic-version': '2023-06-01',
};

// ---------------------------------------------------------------------------
// probe — fetch one endpoint and return a structured result
// ---------------------------------------------------------------------------

/**
 * @param {string} label     Short label used in summary output.
 * @param {string} url       Full URL to GET.
 * @returns {Promise<{label: string, ok: boolean, status?: number, data?: unknown, error?: string}>}
 */
async function probe(label, url) {
  let response;
  try {
    response = await fetch(url, { method: 'GET', headers: HEADERS });
  } catch (err) {
    return { label, ok: false, error: `Network error: ${err.message}` };
  }

  if (!response.ok) {
    let body = null;
    try { body = await response.json(); } catch { /* ignore */ }
    const detail = body?.error?.message ?? JSON.stringify(body) ?? '';
    return {
      label,
      ok: false,
      status: response.status,
      error: `HTTP ${response.status}${detail ? ': ' + detail : ''}`,
    };
  }

  let data = null;
  try { data = await response.json(); } catch { /* ignore */ }
  return { label, ok: true, status: response.status, data };
}

// ---------------------------------------------------------------------------
// Summarise — extract the human-readable detail line per endpoint
// ---------------------------------------------------------------------------

/**
 * @param {string} label
 * @param {unknown} data   Parsed JSON body from the API.
 * @returns {string}
 */
function summarise(label, data) {
  if (!data) return '(no data)';

  switch (label) {
    case 'org/me': {
      const name = data.name ?? '(unknown)';
      const id = data.id ?? '(unknown)';
      return `"${name}" (id: ${id})`;
    }
    case 'users': {
      // The API returns a paged result; we asked for limit=1 so data.data has ≤1 entry.
      // The total count is not returned — report how many records came back plus has_more.
      const count = Array.isArray(data.data) ? data.data.length : 0;
      const hasMore = data.has_more === true;
      return hasMore ? `${count}+ user(s) (has_more=true)` : `${count} user(s) in this page`;
    }
    case 'workspaces': {
      const items = Array.isArray(data.data) ? data.data : [];
      if (items.length === 0) return '(no workspaces)';
      const names = items.map((w) => `"${w.name}" (id: ${w.id})`).join(', ');
      return names;
    }
    case 'invites': {
      const count = Array.isArray(data.data) ? data.data.length : 0;
      const hasMore = data.has_more === true;
      return hasMore ? `${count}+ pending invite(s) (has_more=true)` : `${count} pending invite(s)`;
    }
    default:
      return JSON.stringify(data).slice(0, 120);
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

console.log('--- Anthropic Admin API Probe ---');
console.log(`Key source : ${keySource}`);
console.log(`Key prefix : ${API_KEY.slice(0, 8)}...`);
console.log('');

const results = await Promise.all([
  probe('org/me',     `${BASE}/organizations/me`),
  probe('users',      `${BASE}/organizations/users?limit=1`),
  probe('workspaces', `${BASE}/organizations/workspaces?limit=10`),
  probe('invites',    `${BASE}/organizations/invites?limit=1`),
]);

for (const r of results) {
  const status = r.ok ? 'OK  ' : 'FAIL';
  const label = r.label.padEnd(12);
  if (r.ok) {
    const detail = summarise(r.label, r.data);
    console.log(`${status} ${label} → ${detail}`);
  } else {
    console.log(`${status} ${label} → ${r.error}`);
  }
}

console.log('');

const allOk = results.every((r) => r.ok);
if (allOk) {
  console.log('PASS: All endpoints returned 2xx.');
} else {
  const failCount = results.filter((r) => !r.ok).length;
  console.error(`FAIL: ${failCount} endpoint(s) failed.`);
  process.exit(1);
}
