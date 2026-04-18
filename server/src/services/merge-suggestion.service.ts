/**
 * MergeSuggestionService — stub for Sprint 001.
 *
 * Business logic for merge suggestion approval, rejection, deferral, and
 * the Claude Haiku scanning pipeline is deferred to a later sprint. This
 * stub exists to allow ServiceRegistry to instantiate it without errors.
 *
 * The repository layer (MergeSuggestionRepository) provides all DB-level
 * operations and is fully tested in T006.
 */

import { MergeSuggestionRepository } from './repositories/merge-suggestion.repository.js';
import type { MergeSuggestion } from '../generated/prisma/client.js';

export class MergeSuggestionService {
  constructor(private prisma: any) {}

  /** Return all pending merge suggestions, oldest first. */
  async findPending(): Promise<MergeSuggestion[]> {
    return MergeSuggestionRepository.findPending(this.prisma);
  }

  /**
   * Return the suggestion for a specific user pair.
   * Callers must canonicalise pair order (lower id first).
   */
  async findByPair(userAId: number, userBId: number): Promise<MergeSuggestion | null> {
    return MergeSuggestionRepository.findByPair(this.prisma, userAId, userBId);
  }
}
