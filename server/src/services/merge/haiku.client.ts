/**
 * HaikuClient — Anthropic SDK wrapper for merge similarity evaluation.
 * Sprint 007, T002.
 *
 * Evaluates whether two UserSnapshot objects likely represent the same person.
 * Constructs a structured comparison prompt requesting a JSON response with
 * `confidence` (float 0–1) and `rationale` (string), calls the
 * `claude-haiku-4-5` model, and parses the response.
 *
 * Exports:
 *  - UserSnapshot            — snapshot of user fields used for comparison
 *  - HaikuSimilarityResult   — result shape: { confidence, rationale }
 *  - HaikuApiError           — thrown when the Anthropic SDK throws or returns non-2xx
 *  - HaikuParseError         — thrown when the response body cannot be parsed
 *  - HaikuClient             — interface for evaluating user similarity
 *  - HaikuClientImpl         — real implementation wrapping @anthropic-ai/sdk
 *
 * Environment variables:
 *  - ANTHROPIC_API_KEY — API key for the Anthropic API (required for real calls)
 */

import Anthropic from '@anthropic-ai/sdk';
import { createLogger } from '../logger.js';

const logger = createLogger('haiku-client');

// ---------------------------------------------------------------------------
// Model constant
// ---------------------------------------------------------------------------

/** The Claude Haiku 4.5 model ID used for merge similarity evaluation. */
const HAIKU_MODEL = 'claude-haiku-4-5';

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * A snapshot of user fields relevant to merge similarity evaluation.
 * Built from a User record (and optionally joined Cohort / ExternalAccount data).
 */
export interface UserSnapshot {
  /** Database primary key for correlation in logs. */
  id: number;
  /** User's display name. */
  display_name: string;
  /** Primary email address. */
  primary_email: string;
  /** Pike13 external account ID, if the user has one. */
  pike13_id?: string | null;
  /** Name of the cohort the user belongs to, if any. */
  cohort_name?: string | null;
  /** How the user was created (e.g. 'google_oauth', 'pike13_sync'). */
  created_via: string;
  /** ISO-8601 timestamp of account creation. */
  created_at: string;
}

/**
 * Result of evaluating pairwise user similarity.
 */
export interface HaikuSimilarityResult {
  /**
   * Confidence that the two users are the same person.
   * Float in the range [0.0, 1.0].
   */
  confidence: number;
  /** Human-readable explanation of the similarity assessment. */
  rationale: string;
}

// ---------------------------------------------------------------------------
// Typed errors
// ---------------------------------------------------------------------------

/**
 * Thrown when the Anthropic SDK throws or the API returns a non-2xx status.
 */
export class HaikuApiError extends Error {
  readonly cause?: unknown;

  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = 'HaikuApiError';
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

/**
 * Thrown when the model's response cannot be parsed as a valid
 * `{ confidence: number, rationale: string }` object.
 */
export class HaikuParseError extends Error {
  readonly rawText: string;
  readonly cause?: unknown;

  constructor(message: string, rawText: string, cause?: unknown) {
    super(message);
    this.name = 'HaikuParseError';
    this.rawText = rawText;
    if (cause !== undefined) {
      this.cause = cause;
    }
  }
}

// ---------------------------------------------------------------------------
// HaikuClient interface
// ---------------------------------------------------------------------------

/**
 * Abstraction over the Haiku similarity evaluation call.
 *
 * Implementations:
 *  - HaikuClientImpl  — real, uses @anthropic-ai/sdk
 *  - FakeHaikuClient  — test double in tests/server/helpers/
 */
export interface HaikuClient {
  /**
   * Evaluate whether two users likely represent the same person.
   *
   * @param userA - Snapshot of the first user.
   * @param userB - Snapshot of the second user.
   * @returns A similarity result with confidence in [0.0, 1.0] and rationale.
   * @throws HaikuApiError  when the Anthropic SDK throws or the API errors.
   * @throws HaikuParseError when the model's response is not valid JSON or
   *                          is missing the expected `confidence`/`rationale` fields.
   */
  evaluate(userA: UserSnapshot, userB: UserSnapshot): Promise<HaikuSimilarityResult>;
}

// ---------------------------------------------------------------------------
// HaikuClientImpl — real implementation
// ---------------------------------------------------------------------------

/**
 * Real implementation of HaikuClient using the Anthropic SDK.
 *
 * The constructor accepts an `apiKey` parameter so the API key can be
 * injected (typically from `process.env.ANTHROPIC_API_KEY`). This also
 * makes the class straightforward to instantiate in tests that stub the SDK.
 *
 * Prompt caching is not used for this sprint — the candidate pool is small
 * and the system prompt fits within the non-cached budget comfortably.
 */
export class HaikuClientImpl implements HaikuClient {
  private readonly anthropic: Anthropic;

  constructor(apiKey: string) {
    this.anthropic = new Anthropic({ apiKey });
  }

  /**
   * Build the system prompt instructing Haiku to respond with JSON only.
   */
  private buildSystemPrompt(): string {
    return [
      'You are a data deduplication assistant for a programming school.',
      'Your job is to evaluate whether two user accounts likely belong to the same person.',
      '',
      'You will be given two user records as JSON objects.',
      'Respond with ONLY valid JSON in this exact format — no markdown, no explanation outside the JSON:',
      '',
      '{"confidence": <float between 0.0 and 1.0>, "rationale": "<one or two sentences>"}',
      '',
      'Guidelines:',
      '- confidence 0.9–1.0: very likely the same person (e.g. same name and email)',
      '- confidence 0.6–0.8: probably the same person (e.g. same name, different email)',
      '- confidence 0.3–0.5: possibly the same person (e.g. partial name match)',
      '- confidence 0.0–0.2: likely different people',
      '',
      'Respond ONLY with the JSON object. Do not include any other text.',
    ].join('\n');
  }

  /**
   * Build the user-turn message describing the two users to compare.
   */
  private buildUserMessage(userA: UserSnapshot, userB: UserSnapshot): string {
    const formatUser = (label: string, u: UserSnapshot): string => {
      const fields: string[] = [
        `  "display_name": ${JSON.stringify(u.display_name)}`,
        `  "primary_email": ${JSON.stringify(u.primary_email)}`,
        `  "created_via": ${JSON.stringify(u.created_via)}`,
        `  "created_at": ${JSON.stringify(u.created_at)}`,
      ];
      if (u.pike13_id != null) {
        fields.push(`  "pike13_id": ${JSON.stringify(u.pike13_id)}`);
      }
      if (u.cohort_name != null) {
        fields.push(`  "cohort_name": ${JSON.stringify(u.cohort_name)}`);
      }
      return `${label}:\n{\n${fields.join(',\n')}\n}`;
    };

    return [
      'Please evaluate whether these two user accounts belong to the same person:',
      '',
      formatUser('User A', userA),
      '',
      formatUser('User B', userB),
      '',
      'Respond with ONLY the JSON object as instructed.',
    ].join('\n');
  }

  /**
   * Parse and validate the model's text response as a HaikuSimilarityResult.
   *
   * @throws HaikuParseError if the text is not valid JSON or missing required fields.
   */
  private parseResponse(text: string): HaikuSimilarityResult {
    let parsed: unknown;

    try {
      parsed = JSON.parse(text.trim());
    } catch (err) {
      logger.warn({ rawText: text }, '[haiku-client] Failed to parse response as JSON.');
      throw new HaikuParseError(
        `Haiku response is not valid JSON: ${String(err)}`,
        text,
        err,
      );
    }

    if (
      typeof parsed !== 'object' ||
      parsed === null ||
      typeof (parsed as Record<string, unknown>).confidence !== 'number' ||
      typeof (parsed as Record<string, unknown>).rationale !== 'string'
    ) {
      logger.warn(
        { parsed },
        '[haiku-client] Response JSON is missing required fields (confidence, rationale).',
      );
      throw new HaikuParseError(
        'Haiku response JSON is missing required fields: confidence (number) and rationale (string)',
        text,
      );
    }

    const result = parsed as HaikuSimilarityResult;

    // Clamp confidence to [0, 1] in case the model slightly exceeds bounds
    const confidence = Math.max(0, Math.min(1, result.confidence));

    return { confidence, rationale: result.rationale };
  }

  async evaluate(userA: UserSnapshot, userB: UserSnapshot): Promise<HaikuSimilarityResult> {
    logger.info(
      { userAId: userA.id, userBId: userB.id },
      '[haiku-client] evaluate: requesting similarity evaluation from Haiku.',
    );

    let message: Anthropic.Message;

    try {
      message = await this.anthropic.messages.create({
        model: HAIKU_MODEL,
        max_tokens: 256,
        system: this.buildSystemPrompt(),
        messages: [
          {
            role: 'user',
            content: this.buildUserMessage(userA, userB),
          },
        ],
      });
    } catch (err) {
      logger.error(
        { userAId: userA.id, userBId: userB.id, err },
        '[haiku-client] Anthropic SDK threw during evaluate.',
      );
      throw new HaikuApiError(
        `Anthropic API error during similarity evaluation: ${String(err)}`,
        err,
      );
    }

    // Extract the first text block from the response
    const textBlock = message.content.find(
      (block): block is Anthropic.TextBlock => block.type === 'text',
    );

    if (!textBlock) {
      logger.error(
        { userAId: userA.id, userBId: userB.id, content: message.content },
        '[haiku-client] Haiku response contained no text block.',
      );
      throw new HaikuParseError(
        'Haiku response contained no text block',
        JSON.stringify(message.content),
      );
    }

    const result = this.parseResponse(textBlock.text);

    logger.info(
      { userAId: userA.id, userBId: userB.id, confidence: result.confidence },
      '[haiku-client] evaluate: similarity evaluation complete.',
    );

    return result;
  }
}
