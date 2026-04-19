/**
 * Pike13SyncService — executes the full Pike13 people sync (UC-004).
 *
 * Paginates all people from Pike13 using Pike13ApiClient.listPeople, matches
 * each person against existing Users (by pike13 ExternalAccount external_id,
 * then by primary_email), creates User + ExternalAccount rows for unmatched
 * records, invokes the merge scan stub for each new User, and returns a
 * SyncReport with counts.
 *
 * Design decisions:
 *  - Fail-soft: a person missing an email is skipped (counted in `skipped`).
 *  - Fail-soft per person: individual create errors increment `errors`.
 *  - Fail-soft per page: a Pike13 API error on one page increments `errors`
 *    by the page and continues to the next page (per-cursor retry is not
 *    attempted because we cannot resume from mid-page failures).
 *  - All database writes for a single person (User + ExternalAccount + audit)
 *    are wrapped in a single transaction so partial writes are avoided.
 *  - The sync-completed audit event is written outside any per-person
 *    transaction so it always records the final totals.
 *
 * Dependencies (constructor-injected):
 *  - pike13Client     — Pike13ApiClient (real or fake)
 *  - prisma           — Prisma client for transactions
 *  - userRepo         — UserRepository (static class)
 *  - externalAccountRepo — ExternalAccountRepository (static class)
 *  - auditService     — AuditService
 *  - mergeScanFn      — Injected function that wraps mergeScan stub
 */

import pino from 'pino';
import type { Pike13ApiClient, Pike13Person } from './pike13-api.client.js';
import { UserRepository } from '../repositories/user.repository.js';
import { ExternalAccountRepository } from '../repositories/external-account.repository.js';
import type { AuditService } from '../audit.service.js';
import type { User } from '../../generated/prisma/client.js';
import type { PrismaClient } from '../../generated/prisma/client.js';

const logger = pino({ name: 'pike13-sync' });

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Result returned by Pike13SyncService.sync().
 *
 * Counts:
 *  - created      — new User rows created
 *  - matched      — existing Users matched (by ExternalAccount or email)
 *  - skipped      — persons skipped because they had no email
 *  - errors       — persons (or pages) that produced an error; sync continued
 *  - errorDetails — human-readable descriptions of each error
 */
export interface SyncReport {
  created: number;
  matched: number;
  skipped: number;
  errors: number;
  errorDetails: string[];
}

// Type alias for the merge-scan function so it can be injected / stubbed.
export type MergeScanFn = (user: User) => Promise<void>;

// ---------------------------------------------------------------------------
// Pike13SyncService
// ---------------------------------------------------------------------------

export class Pike13SyncService {
  constructor(
    private readonly pike13Client: Pike13ApiClient,
    private readonly prisma: PrismaClient,
    private readonly userRepo: typeof UserRepository,
    private readonly externalAccountRepo: typeof ExternalAccountRepository,
    private readonly auditService: AuditService,
    private readonly mergeScan: MergeScanFn,
  ) {}

  /**
   * Execute the full Pike13 people sync.
   *
   * @returns SyncReport with counts for created, matched, skipped, errors.
   */
  async sync(): Promise<SyncReport> {
    const report: SyncReport = {
      created: 0,
      matched: 0,
      skipped: 0,
      errors: 0,
      errorDetails: [],
    };

    logger.info('[pike13-sync] Starting Pike13 people sync.');

    let cursor: string | undefined = undefined;
    let pageNumber = 0;

    // Pagination loop — continues until nextCursor is null.
    while (true) {
      pageNumber++;
      let people: Pike13Person[];
      let nextCursor: string | null;

      try {
        const page = await this.pike13Client.listPeople(cursor);
        people = page.people;
        nextCursor = page.nextCursor;

        logger.info(
          { pageNumber, count: people.length, hasMore: nextCursor !== null },
          '[pike13-sync] Fetched page.',
        );
      } catch (err) {
        // API error on a page — record and continue (fail-soft per page).
        const msg = `Page ${pageNumber} (cursor=${cursor ?? 'first'}): ${String(err)}`;
        logger.error({ err, pageNumber }, '[pike13-sync] API error fetching page.');
        report.errors++;
        report.errorDetails.push(msg);
        // We cannot continue pagination without a valid nextCursor, so stop.
        break;
      }

      // Process each person on this page.
      for (const person of people) {
        await this.processPerson(person, report);
      }

      if (nextCursor === null) {
        break;
      }
      cursor = nextCursor;
    }

    // Record the sync-completed audit event (outside any per-person tx).
    try {
      await (this.prisma as any).$transaction(async (tx: any) => {
        await this.auditService.record(tx, {
          action: 'pike13_sync_completed',
          details: {
            created: report.created,
            matched: report.matched,
            skipped: report.skipped,
            errors: report.errors,
          },
        });
      });
    } catch (auditErr) {
      logger.error({ err: auditErr }, '[pike13-sync] Failed to record sync-completed audit event.');
    }

    logger.info(
      { created: report.created, matched: report.matched, skipped: report.skipped, errors: report.errors },
      '[pike13-sync] Sync complete.',
    );

    return report;
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  /**
   * Process a single Pike13 person: match or create User + ExternalAccount.
   * Updates report in place. Never throws — errors are counted in report.errors.
   */
  private async processPerson(person: Pike13Person, report: SyncReport): Promise<void> {
    // Skip persons with no email.
    if (!person.email) {
      logger.warn(
        { personId: person.id },
        '[pike13-sync] Person has no email — skipping.',
      );
      report.skipped++;
      return;
    }

    try {
      // Step 1: Try to match by pike13 ExternalAccount external_id.
      const existingAccount = await (this.prisma as any).externalAccount.findFirst({
        where: {
          type: 'pike13',
          external_id: String(person.id),
        },
      });

      if (existingAccount) {
        logger.debug(
          { personId: person.id, userId: existingAccount.user_id },
          '[pike13-sync] Matched by pike13 ExternalAccount.',
        );
        report.matched++;
        return;
      }

      // Step 2: Try to match by primary_email.
      const existingUser = await this.userRepo.findByEmail(this.prisma, person.email);

      if (existingUser) {
        logger.debug(
          { personId: person.id, userId: existingUser.id, email: person.email },
          '[pike13-sync] Matched by primary_email.',
        );
        report.matched++;
        return;
      }

      // Step 3: No match — create User + ExternalAccount in a single transaction.
      let newUser: User;

      await (this.prisma as any).$transaction(async (tx: any) => {
        newUser = await this.userRepo.create(tx, {
          display_name: `${person.first_name} ${person.last_name}`.trim(),
          primary_email: person.email,
          role: 'student',
          created_via: 'pike13_sync',
        });

        await this.externalAccountRepo.create(tx, {
          user_id: newUser.id,
          type: 'pike13',
          external_id: String(person.id),
          status: 'active',
        });

        await this.auditService.record(tx, {
          action: 'create_user',
          target_user_id: newUser.id,
          target_entity_type: 'User',
          target_entity_id: String(newUser.id),
          details: { source: 'pike13_sync', pike13_person_id: person.id },
        });
      });

      logger.info(
        { personId: person.id, userId: newUser!.id, email: person.email },
        '[pike13-sync] Created new User.',
      );

      // Call merge scan outside the transaction (stub is a no-op in Sprint 006).
      try {
        await this.mergeScan(newUser!);
      } catch (mergeScanErr) {
        logger.error(
          { err: mergeScanErr, userId: newUser!.id },
          '[pike13-sync] mergeScan error (non-fatal).',
        );
      }

      report.created++;
    } catch (err) {
      const msg = `Person ${person.id} (${person.email}): ${String(err)}`;
      logger.error({ err, personId: person.id }, '[pike13-sync] Error processing person.');
      report.errors++;
      report.errorDetails.push(msg);
    }
  }
}
