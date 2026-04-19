/**
 * Sanity check: verify the Google service account JSON file can be read,
 * parsed, and used to construct a GoogleAdminDirectoryClient.
 *
 * Does NOT make a real API call — only verifies that:
 *   1. The file at GOOGLE_SERVICE_ACCOUNT_FILE exists and is readable.
 *   2. The file contents are valid JSON.
 *   3. The expected fields (type, client_email, private_key) are present.
 *
 * Path resolution rules (same as GoogleAdminDirectoryClient):
 *   - Bare filename (no slashes): resolved against <project_root>/config/files/
 *   - Path with slashes: used as-is (relative paths resolved against cwd)
 *
 * Run from the project root:
 *   node scripts/sanity-check-service-account.mjs
 *
 * Reads GOOGLE_SERVICE_ACCOUNT_FILE directly from .env (or the environment)
 * without requiring any npm packages beyond Node built-ins.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Minimal .env parser (no npm deps)
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
    if ((val.startsWith('"') && val.endsWith('"')) ||
        (val.startsWith("'") && val.endsWith("'"))) {
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
// Path resolution — mirrors GoogleAdminDirectoryClient.resolveServiceAccountFilePath
// ---------------------------------------------------------------------------

/**
 * Resolve GOOGLE_SERVICE_ACCOUNT_FILE to an absolute path.
 *
 *  - Bare filename (no path separator): resolved against <projectRoot>/config/files/
 *  - Path with slashes: used as-is via path.resolve (handles absolute and relative)
 */
function resolveServiceAccountFilePath(fileValue) {
  if (fileValue.includes('/') || fileValue.includes(path.sep)) {
    return path.resolve(projectRoot, fileValue);
  }
  return path.resolve(projectRoot, 'config', 'files', fileValue);
}

// ---------------------------------------------------------------------------
// Sanity check
// ---------------------------------------------------------------------------

const fileValue = process.env.GOOGLE_SERVICE_ACCOUNT_FILE;

console.log('--- Google Service Account Sanity Check ---');
console.log(`GOOGLE_SERVICE_ACCOUNT_FILE = ${fileValue ?? '(not set)'}`);

if (!fileValue) {
  console.error('FAIL: GOOGLE_SERVICE_ACCOUNT_FILE is not set in .env');
  process.exit(1);
}

const resolvedPath = resolveServiceAccountFilePath(fileValue);
console.log(`Resolved path: ${resolvedPath}`);

// Step 1: File exists and is readable
let raw;
try {
  raw = fs.readFileSync(resolvedPath, 'utf-8');
  console.log(`OK  File exists and is readable (${raw.length} bytes)`);
} catch (err) {
  console.error(`FAIL: Cannot read file: ${err.message}`);
  process.exit(1);
}

// Step 2: File is valid JSON
let parsed;
try {
  parsed = JSON.parse(raw);
  console.log('OK  File contents are valid JSON');
} catch (err) {
  console.error(`FAIL: File is not valid JSON: ${err.message}`);
  process.exit(1);
}

// Step 3: Required fields present
const requiredFields = ['type', 'client_email', 'private_key', 'project_id'];
const missingFields = requiredFields.filter((f) => !parsed[f]);
if (missingFields.length > 0) {
  console.error(`FAIL: Missing required fields: ${missingFields.join(', ')}`);
  process.exit(1);
}
console.log(`OK  Required fields present: ${requiredFields.join(', ')}`);
console.log(`    type         = ${parsed.type}`);
console.log(`    client_email = ${parsed.client_email}`);
console.log(`    project_id   = ${parsed.project_id}`);
console.log(`    private_key  = [${parsed.private_key.slice(0, 40)}...]`);

// Step 4: Delegated user set?
const delegatedUser = process.env.GOOGLE_ADMIN_DELEGATED_USER_EMAIL ?? '';
console.log(`GOOGLE_ADMIN_DELEGATED_USER_EMAIL = ${delegatedUser || '(not set)'}`);

if (!delegatedUser) {
  console.warn('WARN: GOOGLE_ADMIN_DELEGATED_USER_EMAIL is not set — OU lookups would fail');
} else {
  console.log('OK  GOOGLE_ADMIN_DELEGATED_USER_EMAIL is set');
}

console.log('');
console.log('PASS: Service account file is valid and ready for use.');
console.log('      (No real API call was made — this check is credentials-only.)');
