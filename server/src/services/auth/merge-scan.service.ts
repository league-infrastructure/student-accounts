/**
 * MergeScanService — real Haiku-powered similarity scanner.
 * Sprint 007, T003.
 *
 * Called after every new User creation (social_login or pike13_sync). Compares
 * the new user against all existing active non-staff users, calls the Haiku AI
 * model to evaluate pairwise similarity, and inserts MergeSuggestion rows for
 * pairs whose confidence score meets or exceeds the threshold.
 *
 * Rules:
 *  1. Skips entirely for role=staff users (no API calls).
 *  2. Skips entirely when no other active non-staff users exist.
 *  3. For each candidate pair, calls HaikuClient.evaluate().
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

import pino from 'pino';
import type { User } from '../../generated/prisma/client.js';
import type { HaikuClient, UserSnapshot } from '../merge/haiku.client.js';
import { HaikuApiError, HaikuParseError } from '../merge/haiku.client.js';
import { MergeSuggestionRepository } from '../repositories/merge-suggestion.repository.js';
import { AuditService } from '../audit.service.js';

const logger = pino({ name: 'merge-scan.service' });

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

  // Cheap pre-filter: when the candidate pool is large, only evaluate
  // candidates that share at least one lexical token with the new user.
  // A fresh user imported from Workspace/Pike13 typically has zero lexical
  // overlap with 99% of the population, so sending every pair to Haiku is
  // wasteful and blocks the sign-in path. For small pools (test fixtures,
  // fresh installs) the full scan is cheap and correctness-preserving.
  const PREFILTER_THRESHOLD_SIZE = 20;
  let candidates: any[];
  if (allCandidates.length > PREFILTER_THRESHOLD_SIZE) {
    const newTokens = tokensFor(user.display_name, user.primary_email);
    candidates = allCandidates.filter((c) => {
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
        totalCandidates: allCandidates.length,
        afterPrefilter: candidates.length,
      },
      '[merge-scan] Candidate pre-filter applied.',
    );
  } else {
    candidates = allCandidates;
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

    // Canonicalise pair order: lower id first.
    const userAId = Math.min(user.id, candidate.id);
    const userBId = Math.max(user.id, candidate.id);

    try {
      const suggestion = await MergeSuggestionRepository.create(prisma, {
        user_a_id: userAId,
        user_b_id: userBId,
        haiku_confidence: confidence,
        haiku_rationale: rationale,
        status: 'pending',
      });

      logger.info(
        { suggestionId: suggestion.id, userAId, userBId, confidence },
        '[merge-scan] MergeSuggestion created.',
      );

      // Write audit event (best-effort; failure does not roll back suggestion).
      try {
        await audit.record(prisma, {
          actor_user_id: null,
          action: 'merge_suggestion_created',
          target_user_id: user.id,
          target_entity_type: 'MergeSuggestion',
          target_entity_id: String(suggestion.id),
          details: { user_a_id: userAId, user_b_id: userBId, confidence },
        });
      } catch (auditErr) {
        logger.error(
          { suggestionId: suggestion.id, err: auditErr },
          '[merge-scan] Failed to write merge_suggestion_created audit event.',
        );
      }
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
        continue;
      }
      logger.error(
        { userId: user.id, candidateId: candidate.id, err: createErr },
        '[merge-scan] Unexpected error creating MergeSuggestion — skipping pair.',
      );
    }
  }
}
