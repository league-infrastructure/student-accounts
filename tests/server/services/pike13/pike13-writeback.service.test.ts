/**
 * Integration tests for Pike13WritebackService (Sprint 006 T004).
 *
 * Covers:
 *  - leagueEmail: user has active pike13 ExternalAccount → updateCustomField
 *    called with correct personId, fieldId, and email value.
 *  - leagueEmail: user has no pike13 ExternalAccount → no-op (updateCustomField
 *    not called).
 *  - githubHandle: user has active pike13 ExternalAccount → updateCustomField
 *    called with correct personId, fieldId, and handle value.
 *  - Pike13 API failure (updateCustomField throws) → no throw, error is logged,
 *    audit event is recorded with failed=true.
 *  - Success path: audit event action=pike13_writeback_email is recorded.
 *  - Success path: audit event action=pike13_writeback_github is recorded.
 *  - Missing PIKE13_CUSTOM_FIELD_EMAIL_ID → no-op, no API call.
 *  - Missing PIKE13_CUSTOM_FIELD_GITHUB_ID → no-op, no API call.
 *  - pike13 ExternalAccount has no external_id → no-op, no API call.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { prisma } from '../../../../server/src/services/prisma.js';
import { Pike13WritebackService } from '../../../../server/src/services/pike13/pike13-writeback.service.js';
import { Pike13ApiError } from '../../../../server/src/services/pike13/pike13-api.client.js';
import { FakePike13ApiClient } from '../../helpers/fake-pike13-api.client.js';
import { makeUser, makeExternalAccount } from '../../helpers/factories.js';

// ---------------------------------------------------------------------------
// DB helpers
// ---------------------------------------------------------------------------

async function clearDb() {
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
}

async function findAuditEvents(action: string) {
  return (prisma as any).auditEvent.findMany({ where: { action } });
}

// ---------------------------------------------------------------------------
// Test env setup
// ---------------------------------------------------------------------------

const EMAIL_FIELD_ID = 'field_email_001';
const GITHUB_FIELD_ID = 'field_github_001';
const PERSON_ID = 42;

let originalEmailFieldId: string | undefined;
let originalGithubFieldId: string | undefined;

beforeEach(async () => {
  await clearDb();
  originalEmailFieldId = process.env.PIKE13_CUSTOM_FIELD_EMAIL_ID;
  originalGithubFieldId = process.env.PIKE13_CUSTOM_FIELD_GITHUB_ID;
  process.env.PIKE13_CUSTOM_FIELD_EMAIL_ID = EMAIL_FIELD_ID;
  process.env.PIKE13_CUSTOM_FIELD_GITHUB_ID = GITHUB_FIELD_ID;
});

afterEach(async () => {
  await clearDb();
  if (originalEmailFieldId === undefined) {
    delete process.env.PIKE13_CUSTOM_FIELD_EMAIL_ID;
  } else {
    process.env.PIKE13_CUSTOM_FIELD_EMAIL_ID = originalEmailFieldId;
  }
  if (originalGithubFieldId === undefined) {
    delete process.env.PIKE13_CUSTOM_FIELD_GITHUB_ID;
  } else {
    process.env.PIKE13_CUSTOM_FIELD_GITHUB_ID = originalGithubFieldId;
  }
});

// ---------------------------------------------------------------------------
// Factory for the service under test
// ---------------------------------------------------------------------------

function makeService(fake: FakePike13ApiClient): Pike13WritebackService {
  return new Pike13WritebackService(fake, prisma as any);
}

// ---------------------------------------------------------------------------
// leagueEmail — happy path
// ---------------------------------------------------------------------------

describe('Pike13WritebackService.leagueEmail', () => {
  it('calls updateCustomField with correct args when user has an active pike13 account', async () => {
    const fake = new FakePike13ApiClient();
    const service = makeService(fake);

    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'pike13',
      external_id: String(PERSON_ID),
      status: 'active',
    });

    await service.leagueEmail(user.id, 'student@jointheleague.org');

    expect(fake.calls.updateCustomField).toHaveLength(1);
    expect(fake.calls.updateCustomField[0]).toEqual({
      personId: PERSON_ID,
      fieldId: EMAIL_FIELD_ID,
      value: 'student@jointheleague.org',
    });
  });

  it('records audit event action=pike13_writeback_email on success', async () => {
    const fake = new FakePike13ApiClient();
    const service = makeService(fake);

    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'pike13',
      external_id: String(PERSON_ID),
      status: 'active',
    });

    await service.leagueEmail(user.id, 'student@jointheleague.org');

    const events = await findAuditEvents('pike13_writeback_email');
    expect(events).toHaveLength(1);
    expect(events[0].target_user_id).toBe(user.id);
    expect(events[0].details).toMatchObject({
      personId: PERSON_ID,
      fieldId: EMAIL_FIELD_ID,
      value: 'student@jointheleague.org',
    });
  });

  it('is a no-op when user has no pike13 ExternalAccount', async () => {
    const fake = new FakePike13ApiClient();
    const service = makeService(fake);

    const user = await makeUser();
    // No pike13 ExternalAccount created

    await service.leagueEmail(user.id, 'student@jointheleague.org');

    expect(fake.calls.updateCustomField).toHaveLength(0);
    const events = await findAuditEvents('pike13_writeback_email');
    expect(events).toHaveLength(0);
  });

  it('does not throw when updateCustomField throws Pike13ApiError', async () => {
    const fake = new FakePike13ApiClient();
    fake.configureError(
      'updateCustomField',
      new Pike13ApiError('Server error', 'updateCustomField', 500),
    );
    const service = makeService(fake);

    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'pike13',
      external_id: String(PERSON_ID),
      status: 'active',
    });

    // Must not throw
    await expect(
      service.leagueEmail(user.id, 'student@jointheleague.org'),
    ).resolves.toBeUndefined();
  });

  it('records a failure audit event when updateCustomField throws', async () => {
    const fake = new FakePike13ApiClient();
    fake.configureError(
      'updateCustomField',
      new Pike13ApiError('Server error', 'updateCustomField', 500),
    );
    const service = makeService(fake);

    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'pike13',
      external_id: String(PERSON_ID),
      status: 'active',
    });

    await service.leagueEmail(user.id, 'student@jointheleague.org');

    const events = await findAuditEvents('pike13_writeback_email');
    expect(events).toHaveLength(1);
    expect(events[0].details).toMatchObject({ failed: true });
  });

  it('is a no-op when PIKE13_CUSTOM_FIELD_EMAIL_ID is not set', async () => {
    delete process.env.PIKE13_CUSTOM_FIELD_EMAIL_ID;

    const fake = new FakePike13ApiClient();
    const service = makeService(fake);

    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'pike13',
      external_id: String(PERSON_ID),
      status: 'active',
    });

    await service.leagueEmail(user.id, 'student@jointheleague.org');

    expect(fake.calls.updateCustomField).toHaveLength(0);
  });

  it('is a no-op when pike13 ExternalAccount has no external_id', async () => {
    const fake = new FakePike13ApiClient();
    const service = makeService(fake);

    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'pike13',
      external_id: null,
      status: 'active',
    });

    await service.leagueEmail(user.id, 'student@jointheleague.org');

    expect(fake.calls.updateCustomField).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// githubHandle — happy path
// ---------------------------------------------------------------------------

describe('Pike13WritebackService.githubHandle', () => {
  it('calls updateCustomField with correct args when user has an active pike13 account', async () => {
    const fake = new FakePike13ApiClient();
    const service = makeService(fake);

    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'pike13',
      external_id: String(PERSON_ID),
      status: 'active',
    });

    await service.githubHandle(user.id, 'octocat');

    expect(fake.calls.updateCustomField).toHaveLength(1);
    expect(fake.calls.updateCustomField[0]).toEqual({
      personId: PERSON_ID,
      fieldId: GITHUB_FIELD_ID,
      value: 'octocat',
    });
  });

  it('records audit event action=pike13_writeback_github on success', async () => {
    const fake = new FakePike13ApiClient();
    const service = makeService(fake);

    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'pike13',
      external_id: String(PERSON_ID),
      status: 'active',
    });

    await service.githubHandle(user.id, 'octocat');

    const events = await findAuditEvents('pike13_writeback_github');
    expect(events).toHaveLength(1);
    expect(events[0].target_user_id).toBe(user.id);
    expect(events[0].details).toMatchObject({
      personId: PERSON_ID,
      fieldId: GITHUB_FIELD_ID,
      value: 'octocat',
    });
  });

  it('is a no-op when user has no pike13 ExternalAccount', async () => {
    const fake = new FakePike13ApiClient();
    const service = makeService(fake);

    const user = await makeUser();

    await service.githubHandle(user.id, 'octocat');

    expect(fake.calls.updateCustomField).toHaveLength(0);
  });

  it('does not throw when updateCustomField throws Pike13ApiError', async () => {
    const fake = new FakePike13ApiClient();
    fake.configureError(
      'updateCustomField',
      new Pike13ApiError('Not found', 'updateCustomField', 404),
    );
    const service = makeService(fake);

    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'pike13',
      external_id: String(PERSON_ID),
      status: 'active',
    });

    await expect(service.githubHandle(user.id, 'octocat')).resolves.toBeUndefined();
  });

  it('is a no-op when PIKE13_CUSTOM_FIELD_GITHUB_ID is not set', async () => {
    delete process.env.PIKE13_CUSTOM_FIELD_GITHUB_ID;

    const fake = new FakePike13ApiClient();
    const service = makeService(fake);

    const user = await makeUser();
    await makeExternalAccount(user, {
      type: 'pike13',
      external_id: String(PERSON_ID),
      status: 'active',
    });

    await service.githubHandle(user.id, 'octocat');

    expect(fake.calls.updateCustomField).toHaveLength(0);
  });
});
