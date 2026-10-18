/**
 * MergeScanService — rule-based pass plus the Haiku-powered similarity scanner.
 * Sprint 007, T003; deterministic rules added in sprint 002 T008.
 *
 * Called after every new User creation (social_login, pike13_sync,
 * laptop_import). Compares the new user against all existing active non-staff
 * users: first with cheap deterministic rules (`ruleMatch`), then by calling
 * the Haiku AI model for the remaining pairs, and inserts MergeSuggestion rows
 * for pairs whose confidence score meets or exceeds the threshold.
 *
 * Rule-based pass (no LLM call for hits, confidence 1.0):
 *  - `same username as email local part` — one user's `username` equals the
 *    local part of the other's `primary_email` (case-insensitive). This is
 *    the laptop-import case: roster id `alice` vs. `alice@gmail.com`.
 *  - `same display name` — normalised display names match (lowercase,
 *    whitespace collapsed, at least two tokens).
 *  `ruleScanAll(createdVia)` backfills these rules over existing users.
 *
 * LLM pass rules:
 *  1. Skips entirely for role=staff users (no API calls).
 *  2. Skips entirely when no other active non-staff users exist.
 *  3. For each remaining candidate pair, calls HaikuClient.evaluate().
 *  4. Confidence >= MERGE_SCAN_CONFIDENCE_THRESHOLD (default 0.6) → create row.
 *  5. Pair order is canonicalised: lower id → user_a_id.
 *  6. Unique-constraint violations (duplicate pair) are caught silently.
 *  7. HaikuApiError / HaikuParseError are caught per-pair, logged at ERROR,
 *     and do NOT roll back User creation.
 *  8. An AuditEvent (action=merge_suggestion_created) is written for each row.
 *
 * Environment variables:
 *  - MERGE_SCAN_CONFIDENCE_THRESHOLD — overrides the 0.6 default.
 */

import { createLogger } from '../logger.js';
import type { User } from '../../generated/prisma/client.js';
import type { HaikuClient, UserSnapshot } from '../merge/haiku.client.js';
import { HaikuApiError, HaikuParseError } from '../merge/haiku.client.js';
import { MergeSuggestionRepository } from '../repositories/merge-suggestion.repository.js';
import { AuditService } from '../audit.service.js';

const logger = createLogger('merge-scan.service');

/** Default confidence threshold below which no MergeSuggestion row is created. */
const DEFAULT_THRESHOLD = 0.6;

/**
 * Read the confidence threshold from process.env.
 * Falls back to DEFAULT_THRESHOLD if unset or unparseable.
 */
function resolveThreshold(): number {
  const raw = process.env.MERGE_SCAN_CONFIDENCE_THRESHOLD;
  if (raw !== undefined && raw.trim() !== '') {
    const parsed = parseFloat(raw);
    if (!isNaN(parsed)) {
      return parsed;
    }
    logger.warn(
      { raw },
      '[merge-scan] MERGE_SCAN_CONFIDENCE_THRESHOLD is not a valid float — using default 0.6.',
    );
  }
  return DEFAULT_THRESHOLD;
}

/** Common stop-words that carry no identity signal. */
const TOKEN_STOP_WORDS = new Set([
  'student', 'students', 'parent', 'parents', 'guardian', 'family',
  'test', 'demo', 'example', 'user', 'admin',
  'com', 'org', 'edu', 'net',
]);

/**
 * Tokenize a user's display name and email local part into a set of
 * lowercase tokens for cheap lexical overlap comparison.
 */
function tokensFor(displayName: string | null | undefined, email: string | null | undefined): Set<string> {
  const out = new Set<string>();
  const add = (s: string | null | undefined) => {
    if (!s) return;
    for (const raw of s.toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 2) continue;
      if (TOKEN_STOP_WORDS.has(raw)) continue;
      out.add(raw);
    }
  };
  add(displayName);
  if (email) {
    const local = email.split('@')[0] ?? '';
    add(local);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Rule-based matching (sprint 002 T008)
// ---------------------------------------------------------------------------

export const RULE_SAME_USERNAME_LOCAL_PART = 'same username as email local part';
export const RULE_SAME_DISPLAY_NAME = 'same display name';

/** The User columns the rules look at. */
export interface RuleUser {
  id: number;
  username?: string | null;
  primary_email: string;
  display_name: string;
}

/** Lowercase local part of an email address, or null when there is none. */
export function emailLocalPart(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf('@');
  if (at <= 0) return null;
  return email.slice(0, at).toLowerCase();
}

/**
 * Display name normalised for comparison: lowercase, whitespace collapsed.
 * Returns null for names with fewer than two tokens (a lone first name is
 * not identity evidence).
 */
export function normalizeDisplayName(name: string | null | undefined): string | null {
  if (!name) return null;
  const tokens = name.toLowerCase().split(/\s+/).filter((t) => t.length > 0);
  if (tokens.length < 2) return null;
  return tokens.join(' ');
}

/**
 * Deterministic match between two users; returns the rationale or null.
 * Checked in both directions so a Google sign-up after the laptop import
 * finds the imported user just as the import finds the Google user.
 */
export function ruleMatch(a: RuleUser, b: RuleUser): string | null {
  const aUsername = a.username?.toLowerCase() ?? null;
  const bUsername = b.username?.toLowerCase() ?? null;
  if (aUsername && aUsername === emailLocalPart(b.primary_email)) {
    return RULE_SAME_USERNAME_LOCAL_PART;
  }
  if (bUsername && bUsername === emailLocalPart(a.primary_email)) {
    return RULE_SAME_USERNAME_LOCAL_PART;
  }
  const aName = normalizeDisplayName(a.display_name);
  if (aName !== null && aName === normalizeDisplayName(b.display_name)) {
    return RULE_SAME_DISPLAY_NAME;
  }
  return null;
}

/**
 * Create a MergeSuggestion for the pair (canonical order) and its
 * merge_suggestion_created audit event. Returns false when the pair already
 * has a row (P2002) or the insert failed; never throws.
 */
async function createSuggestion(
  prisma: any,
  audit: AuditService,
  newUserId: number,
  candidateId: number,
  confidence: number,
  rationale: string,
): Promise<boolean> {
  const userAId = Math.min(newUserId, candidateId);
  const userBId = Math.max(newUserId, candidateId);

  try {
    const suggestion = await MergeSuggestionRepository.create(prisma, {
      user_a_id: userAId,
      user_b_id: userBId,
      haiku_confidence: confidence,
      haiku_rationale: rationale,
      status: 'pending',
    });

    logger.info(
      { suggestionId: suggestion.id, userAId, userBId, confidence, rationale },
      '[merge-scan] MergeSuggestion created.',
    );

    // Write audit event (best-effort; failure does not roll back suggestion).
    try {
      await audit.record(prisma, {
        actor_user_id: null,
        action: 'merge_suggestion_created',
        target_user_id: newUserId,
        target_entity_type: 'MergeSuggestion',
        target_entity_id: String(suggestion.id),
        details: { user_a_id: userAId, user_b_id: userBId, confidence, rationale },
      });
    } catch (auditErr) {
      logger.error(
        { suggestionId: suggestion.id, err: auditErr },
        '[merge-scan] Failed to write merge_suggestion_created audit event.',
      );
    }
    return true;
  } catch (createErr: any) {
    // Unique constraint violation (P2002 in Prisma) — silently skip.
    if (
      createErr?.code === 'P2002' ||
      (createErr?.message as string | undefined)?.includes('Unique constraint')
    ) {
      logger.debug(
        { userAId, userBId },
        '[merge-scan] Duplicate pair (unique constraint) — skipping.',
      );
      return false;
    }
    logger.error(
      { userId: newUserId, candidateId, err: createErr },
      '[merge-scan] Unexpected error creating MergeSuggestion — skipping pair.',
    );
    return false;
  }
}

/**
 * Rule pass for `user` against `candidates`. Returns the ids of candidates
 * that matched a rule (whether or not a row was created — an existing row
 * for the pair also means the LLM need not look at it).
 */
async function rulePass(
  user: RuleUser,
  candidates: RuleUser[],
  prisma: any,
  audit: AuditService,
): Promise<{ matched: Set<number>; created: number }> {
  const matched = new Set<number>();
  let created = 0;
  for (const candidate of candidates) {
    const rationale = ruleMatch(user, candidate);
    if (!rationale) continue;
    matched.add(candidate.id);
    if (await createSuggestion(prisma, audit, user.id, candidate.id, 1.0, rationale)) {
      created++;
    }
  }
  return { matched, created };
}

export interface RuleScanAllResult {
  /** Users with the given created_via that were scanned. */
  scanned: number;
  /** New MergeSuggestion rows created. */
  created: number;
}

/**
 * Backfill: run the rule pass for every active user with `created_via`
 * against every other active non-staff user. Idempotent (existing pairs are
 * skipped). No LLM calls.
 */
export async function ruleScanAll(
  prisma: any,
  audit: AuditService,
  createdVia: string = 'laptop_import',
): Promise<RuleScanAllResult> {
  const subjects: RuleUser[] = await (prisma as any).user.findMany({
    where: { created_via: createdVia, is_active: true, role: { not: 'staff' } },
    select: { id: true, username: true, primary_email: true, display_name: true },
    orderBy: { id: 'asc' },
  });
  const others: RuleUser[] = await (prisma as any).user.findMany({
    where: { is_active: true, role: { not: 'staff' } },
    select: { id: true, username: true, primary_email: true, display_name: true },
  });

  let created = 0;
  for (const subject of subjects) {
    const candidates = others.filter((o) => o.id !== subject.id);
    const result = await rulePass(subject, candidates, prisma, audit);
    created += result.created;
  }
  logger.info({ createdVia, scanned: subjects.length, created }, '[merge-scan] Rule backfill done.');
  return { scanned: subjects.length, created };
}

/**
 * Build a UserSnapshot from a raw Prisma user row (with optional joined data).
 */
function toSnapshot(user: any): UserSnapshot {
  // Find pike13 external account id if present
  const pike13Account = user.external_accounts?.find((ea: any) => ea.type === 'pike13');
  const cohortName = user.cohort?.name ?? null;

  return {
    id: user.id,
    display_name: user.display_name,
    primary_email: user.primary_email,
    pike13_id: pike13Account?.external_id ?? null,
    cohort_name: cohortName,
    created_via: user.created_via,
    created_at: (user.created_at instanceof Date
      ? user.created_at.toISOString()
      : String(user.created_at)),
  };
}

/**
 * Scan the newly created user against all existing candidates and create
 * MergeSuggestion rows for pairs above the confidence threshold.
 *
 * @param user     - The newly created User record.
 * @param prisma   - Prisma client (or any compatible DbClient).
 * @param haiku    - HaikuClient implementation to use for evaluation.
 * @param audit    - AuditService for writing merge_suggestion_created events.
 */
export async function mergeScanWithDeps(
  user: User,
  prisma: any,
  haiku: HaikuClient,
  audit: AuditService,
): Promise<void> {
  // Rule 1: Skip for staff users.
  if (user.role === 'staff') {
    logger.debug(
      { userId: user.id, role: user.role },
      '[merge-scan] Skipping scan for staff user.',
    );
    return;
  }

  const threshold = resolveThreshold();

  // Load all other active non-staff users with their external accounts and cohort.
  const allCandidates: any[] = await (prisma as any).user.findMany({
    where: {
      id: { not: user.id },
      is_active: true,
      role: { not: 'staff' },
    },
    include: {
      external_accounts: true,
      cohort: true,
    },
  });

  // Rule 2: Skip when no candidates exist.
  if (allCandidates.length === 0) {
    logger.debug(
      { userId: user.id },
      '[merge-scan] No candidate users — skipping scan.',
    );
    return;
  }

  // Deterministic rules first (sprint 002 T008). Hits are recorded with
  // confidence 1.0 and never sent to the LLM.
  const rule = await rulePass(user, allCandidates, prisma, audit);
  if (rule.matched.size > 0) {
    logger.info(
      { userId: user.id, ruleHits: rule.matched.size, created: rule.created },
      '[merge-scan] Rule-based suggestions.',
    );
  }
  const llmCandidates = allCandidates.filter((c) => !rule.matched.has(c.id));

  // Cheap pre-filter: when the candidate pool is large, only evaluate
  // candidates that share at least one lexical token with the new user.
  // A fresh user imported from Workspace/Pike13 typically has zero lexical
  // overlap with 99% of the population, so sending every pair to Haiku is
  // wasteful and blocks the sign-in path. For small pools (test fixtures,
  // fresh installs) the full scan is cheap and correctness-preserving.
  const PREFILTER_THRESHOLD_SIZE = 20;
  let candidates: any[];
  if (llmCandidates.length > PREFILTER_THRESHOLD_SIZE) {
    const newTokens = tokensFor(user.display_name, user.primary_email);
    candidates = llmCandidates.filter((c) => {
      if (c.primary_email?.toLowerCase() === user.primary_email?.toLowerCase()) {
        return true;
      }
      const ctokens = tokensFor(c.display_name, c.primary_email);
      for (const t of ctokens) {
        if (newTokens.has(t)) return true;
      }
      return false;
    });
    logger.info(
      {
        userId: user.id,
        totalCandidates: llmCandidates.length,
        afterPrefilter: candidates.length,
      },
      '[merge-scan] Candidate pre-filter applied.',
    );
  } else {
    candidates = llmCandidates;
  }

  if (candidates.length === 0) {
    return;
  }

  const newUserSnapshot = toSnapshot({
    ...user,
    external_accounts: [],
    cohort: null,
  });

  for (const candidate of candidates) {
    const candidateSnapshot = toSnapshot(candidate);

    let confidence: number;
    let rationale: string;

    try {
      const result = await haiku.evaluate(newUserSnapshot, candidateSnapshot);
      confidence = result.confidence;
      rationale = result.rationale;
    } catch (err) {
      if (err instanceof HaikuApiError || err instanceof HaikuParseError) {
        // Abort the entire scan on auth failures — no point hammering the
        // API with an invalid key for every remaining candidate.
        const msg = String((err as Error).message ?? '');
        if (msg.includes('401') || msg.includes('authentication_error') || msg.includes('invalid x-api-key')) {
          logger.error(
            { userId: user.id, err },
            '[merge-scan] Haiku authentication failure — aborting scan.',
          );
          return;
        }
        logger.error(
          { userId: user.id, candidateId: candidate.id, err },
          '[merge-scan] Haiku evaluation error — skipping pair, continuing scan.',
        );
        continue;
      }
      throw err;
    }

    if (confidence < threshold) {
      logger.debug(
        { userId: user.id, candidateId: candidate.id, confidence, threshold },
        '[merge-scan] Confidence below threshold — no suggestion created.',
      );
      continue;
    }

    await createSuggestion(prisma, audit, user.id, candidate.id, confidence, rationale);
  }
}
