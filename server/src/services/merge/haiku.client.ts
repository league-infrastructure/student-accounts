/**
 * HaikuClient — OpenRouter fetch wrapper for merge similarity evaluation.
 * Sprint 007, T002. Switched to OpenRouter in Sprint 001 (ticket 005).
 *
 * Evaluates whether two UserSnapshot objects likely represent the same person.
 * Constructs a structured comparison prompt requesting a JSON response with
 * `confidence` (float 0–1) and `rationale` (string), POSTs to OpenRouter's
 * chat completions endpoint, and parses the response.
 *
 * Exports:
 *  - UserSnapshot            — snapshot of user fields used for comparison
 *  - HaikuSimilarityResult   — result shape: { confidence, rationale }
 *  - HaikuApiError           — thrown when fetch throws or API returns non-2xx
 *  - HaikuParseError         — thrown when the response body cannot be parsed
 *  - HaikuClient             — interface for evaluating user similarity
 *  - HaikuClientImpl         — real implementation using fetch (OpenAI Chat Completions format)
 *
 * Environment variables:
 *  - OPENROUTER_API_KEY    — API key for OpenRouter (preferred)
 *  - LLM_PROXY_BASE_URL    — base URL for the chat completions endpoint
 *                            (default: 'https://openrouter.ai/api/v1/chat/completions')
 *  - LLM_PROXY_MODEL_SMALL — model to use for merge evaluation
 *                            (default: 'deepseek/deepseek-v3.2')
 */

import { createLogger } from '../logger.js';

const logger = createLogger('haiku-client');

// ---------------------------------------------------------------------------
// Model constant
// ---------------------------------------------------------------------------

/** The model used for merge similarity evaluation, read from env at call time. */
const MERGE_EVAL_MODEL =
  process.env.LLM_PROXY_MODEL_SMALL ?? 'deepseek/deepseek-v3.2';

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
 * Thrown when fetch throws (network error) or the API returns a non-2xx status.
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
 * Abstraction over the merge similarity evaluation call.
 *
 * Implementations:
 *  - HaikuClientImpl  — real, uses fetch against OpenRouter
 *  - FakeHaikuClient  — test double in tests/server/helpers/
 */
export interface HaikuClient {
  /**
   * Evaluate whether two users likely represent the same person.
   *
   * @param userA - Snapshot of the first user.
   * @param userB - Snapshot of the second user.
   * @returns A similarity result with confidence in [0.0, 1.0] and rationale.
   * @throws HaikuApiError  when fetch throws or the API returns a non-2xx status.
   * @throws HaikuParseError when the model's response is not valid JSON or
   *                          is missing the expected `confidence`/`rationale` fields.
   */
  evaluate(userA: UserSnapshot, userB: UserSnapshot): Promise<HaikuSimilarityResult>;
}

// ---------------------------------------------------------------------------
// HaikuClientImpl — real implementation
// ---------------------------------------------------------------------------

/**
 * Real implementation of HaikuClient using fetch against the OpenRouter
 * chat completions endpoint (OpenAI Chat Completions format).
 *
 * The constructor accepts an `apiKey` parameter so the API key can be
 * injected (typically from `process.env.OPENROUTER_API_KEY`). This also
 * makes the class straightforward to instantiate in tests that stub fetch.
 */
export class HaikuClientImpl implements HaikuClient {
  private readonly apiKey: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  /**
   * Build the system prompt instructing the model to respond with JSON only.
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
      '[haiku-client] evaluate: requesting similarity evaluation from OpenRouter.',
    );

    const baseUrl =
      process.env.LLM_PROXY_BASE_URL ?? 'https://openrouter.ai/api/v1/chat/completions';

    const body = {
      model: MERGE_EVAL_MODEL,
      max_tokens: 256,
      messages: [
        { role: 'system', content: this.buildSystemPrompt() },
        { role: 'user', content: this.buildUserMessage(userA, userB) },
      ],
    };

    let response: Response;

    try {
      response = await fetch(baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify(body),
      });
    } catch (err) {
      logger.error(
        { userAId: userA.id, userBId: userB.id, err },
        '[haiku-client] fetch threw during evaluate (network error).',
      );
      throw new HaikuApiError(
        `OpenRouter network error during similarity evaluation: ${String(err)}`,
        err,
      );
    }

    if (!response.ok) {
      const responseText = await response.text().catch(() => '(unreadable)');
      logger.error(
        { userAId: userA.id, userBId: userB.id, status: response.status, responseText },
        '[haiku-client] OpenRouter returned non-2xx status.',
      );
      throw new HaikuApiError(
        `OpenRouter API error during similarity evaluation: HTTP ${response.status} — ${responseText}`,
      );
    }

    let data: { choices: Array<{ message: { content: string } }> };

    try {
      data = (await response.json()) as typeof data;
    } catch (err) {
      logger.error(
        { userAId: userA.id, userBId: userB.id, err },
        '[haiku-client] Failed to parse OpenRouter response as JSON.',
      );
      throw new HaikuParseError(
        `Failed to parse OpenRouter response as JSON: ${String(err)}`,
        '',
        err,
      );
    }

    const content = data?.choices?.[0]?.message?.content;

    if (typeof content !== 'string') {
      logger.error(
        { userAId: userA.id, userBId: userB.id, data },
        '[haiku-client] OpenRouter response missing choices[0].message.content.',
      );
      throw new HaikuParseError(
        'OpenRouter response missing choices[0].message.content',
        JSON.stringify(data),
      );
    }

    const result = this.parseResponse(content);

    logger.info(
      { userAId: userA.id, userBId: userB.id, confidence: result.confidence },
      '[haiku-client] evaluate: similarity evaluation complete.',
    );

    return result;
  }
}
