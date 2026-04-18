/**
 * Integration tests for LoginService.
 *
 * Covers:
 *  - create: creates Login + add_login AuditEvent atomically
 *  - create: throws ConflictError when (provider, providerUserId) already exists
 *  - findByProvider: returns Login or null
 *  - findAllByUser: returns all logins for a user
 *  - delete: removes Login + records remove_login audit event
 *  - delete: throws NotFoundError for unknown login
 *  - delete: throws ValidationError when it would leave user with zero logins
 */
import { prisma } from '../../../server/src/services/prisma.js';
import { AuditService } from '../../../server/src/services/audit.service.js';
import { LoginService } from '../../../server/src/services/login.service.js';
import { ConflictError, NotFoundError, ValidationError } from '../../../server/src/errors.js';
import { makeUser, makeLogin } from '../helpers/factories.js';

let loginService: LoginService;

beforeEach(async () => {
  await (prisma as any).mergeSuggestion.deleteMany();
  await (prisma as any).provisioningRequest.deleteMany();
  await (prisma as any).auditEvent.deleteMany();
  await (prisma as any).externalAccount.deleteMany();
  await (prisma as any).login.deleteMany();
  await (prisma as any).user.deleteMany();
  await (prisma as any).cohort.deleteMany();

  loginService = new LoginService(prisma, new AuditService());
});

// ---------------------------------------------------------------------------
// create
// ---------------------------------------------------------------------------

describe('LoginService.create', () => {
  it('creates a Login and an add_login AuditEvent atomically', async () => {
    const user = await makeUser();

    const login = await loginService.create(
      user.id,
      'google',
      'google_uid_001',
      'user@gmail.com',
    );

    expect(login.id).toBeDefined();
    expect(login.user_id).toBe(user.id);
    expect(login.provider).toBe('google');

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'add_login', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].target_entity_type).toBe('Login');
  });

  it('throws ConflictError when (provider, providerUserId) is already in use', async () => {
    const user = await makeUser();
    await makeLogin(user, { provider: 'github', provider_user_id: 'gh_001' });

    await expect(
      loginService.create(user.id, 'github', 'gh_001'),
    ).rejects.toThrow(ConflictError);
  });
});

// ---------------------------------------------------------------------------
// findByProvider
// ---------------------------------------------------------------------------

describe('LoginService.findByProvider', () => {
  it('returns the Login when it exists', async () => {
    const user = await makeUser();
    await makeLogin(user, { provider: 'google', provider_user_id: 'g_find_test' });

    const found = await loginService.findByProvider('google', 'g_find_test');
    expect(found).not.toBeNull();
    expect(found!.user_id).toBe(user.id);
  });

  it('returns null for an unknown (provider, providerUserId)', async () => {
    const result = await loginService.findByProvider('google', 'nobody');
    expect(result).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// findAllByUser
// ---------------------------------------------------------------------------

describe('LoginService.findAllByUser', () => {
  it('returns all logins for the user', async () => {
    const user = await makeUser();
    await makeLogin(user, { provider: 'google', provider_user_id: 'g_u1' });
    await makeLogin(user, { provider: 'github', provider_user_id: 'gh_u1' });

    const logins = await loginService.findAllByUser(user.id);
    expect(logins).toHaveLength(2);
  });

  it('returns an empty array when the user has no logins', async () => {
    const user = await makeUser();
    const logins = await loginService.findAllByUser(user.id);
    expect(logins).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// delete
// ---------------------------------------------------------------------------

describe('LoginService.delete', () => {
  it('throws NotFoundError for a non-existent login id', async () => {
    await expect(loginService.delete(9999999)).rejects.toThrow(NotFoundError);
  });

  it('throws ValidationError when deleting the last login', async () => {
    const user = await makeUser();
    const login = await makeLogin(user);

    await expect(loginService.delete(login.id)).rejects.toThrow(ValidationError);

    // Login must still exist
    const still = await (prisma as any).login.findUnique({ where: { id: login.id } });
    expect(still).not.toBeNull();
  });

  it('deletes the Login and records remove_login audit event when another login remains', async () => {
    const user = await makeUser();
    const login1 = await makeLogin(user, { provider: 'google', provider_user_id: 'g_keep' });
    const login2 = await makeLogin(user, { provider: 'github', provider_user_id: 'gh_del' });

    await loginService.delete(login2.id, null);

    const gone = await (prisma as any).login.findUnique({ where: { id: login2.id } });
    expect(gone).toBeNull();

    // login1 still exists
    const kept = await (prisma as any).login.findUnique({ where: { id: login1.id } });
    expect(kept).not.toBeNull();

    const events = await (prisma as any).auditEvent.findMany({
      where: { action: 'remove_login', target_user_id: user.id },
    });
    expect(events).toHaveLength(1);
    expect(events[0].target_entity_id).toBe(String(login2.id));
  });
});
