/**
 * FakeGoogleWorkspaceAdminClient — test double for GoogleWorkspaceAdminClient.
 *
 * Implements the GoogleWorkspaceAdminClient interface using in-memory state.
 * No network calls are made. All methods record their invocations in the
 * `calls` object for test assertions.
 *
 * Configurable behavior:
 *  - `configure(method, value)` — set a return value for a method (overrides
 *    the built-in default).
 *  - `configureError(method, error)` — make a method throw an error.
 *  - `reset()` — clear all recorded calls and configured overrides.
 *
 * Default return values (when no override is configured):
 *  - `getUserOU`     → '/League Staff'
 *  - `listOUs`       → [] (or seeded value from ouSeed map)
 *  - `createUser`    → { id: 'fake-gws-user-id', primaryEmail: params.primaryEmail }
 *  - `createOU`      → { ouPath: '/Students/' + name }
 *  - `suspendUser`   → resolves void
 *  - `deleteUser`    → resolves void
 *  - `listUsersInOU` → []
 *
 * Usage in tests:
 *
 *   const fake = new FakeGoogleWorkspaceAdminClient();
 *
 *   // Override a return value
 *   fake.configure('createUser', { id: 'custom-id', primaryEmail: 'x@students.example.com' });
 *
 *   // Make a method throw
 *   fake.configureError('createOU', new WorkspaceApiError('OU already exists', 'createOU', 409));
 *
 *   // Assert calls
 *   expect(fake.calls.createUser).toHaveLength(1);
 *   expect(fake.calls.createUser[0].primaryEmail).toBe('alice@students.example.com');
 *
 *   // Reset between tests
 *   fake.reset();
 */

import type {
  GoogleWorkspaceAdminClient,
  CreateUserParams,
  CreatedUser,
  CreatedOU,
  WorkspaceUser,
  WorkspaceOU,
} from '../../../server/src/services/google-workspace/google-workspace-admin.client.js';

// ---------------------------------------------------------------------------
// Call recorder types
// ---------------------------------------------------------------------------

export interface FakeCallRecords {
  getUserOU: string[];
  listOUs: string[];
  createUser: CreateUserParams[];
  createOU: string[];
  suspendUser: string[];
  deleteUser: string[];
  listUsersInOU: string[];
}

// ---------------------------------------------------------------------------
// Method return value overrides (keyed by method name)
// ---------------------------------------------------------------------------

type MethodReturnOverrides = {
  getUserOU?: string;
  listOUs?: WorkspaceOU[];
  createUser?: CreatedUser;
  createOU?: CreatedOU;
  suspendUser?: void;
  deleteUser?: void;
  listUsersInOU?: WorkspaceUser[];
};

type MethodErrorOverrides = {
  [K in keyof MethodReturnOverrides]?: Error;
};

// ---------------------------------------------------------------------------
// FakeGoogleWorkspaceAdminClient
// ---------------------------------------------------------------------------

export class FakeGoogleWorkspaceAdminClient implements GoogleWorkspaceAdminClient {
  /**
   * Seeded OU data for listOUs: maps parentPath → array of child WorkspaceOU.
   * Populate this before calling listOUs in tests.
   *
   *   fake.seedOUs('/Students', [{ orgUnitPath: '/Students/Spring2025', name: 'Spring2025' }]);
   */
  readonly ouSeed: Map<string, WorkspaceOU[]> = new Map();

  /** Recorded call arguments, indexed by method name. */
  readonly calls: FakeCallRecords = {
    getUserOU: [],
    listOUs: [],
    createUser: [],
    createOU: [],
    suspendUser: [],
    deleteUser: [],
    listUsersInOU: [],
  };

  private returnOverrides: MethodReturnOverrides = {};
  private errorOverrides: MethodErrorOverrides = {};

  /**
   * Configure a return value for a method. Overrides the built-in default.
   *
   * @param method - The method name to configure.
   * @param value  - The value to return when the method is called.
   */
  configure<K extends keyof MethodReturnOverrides>(method: K, value: MethodReturnOverrides[K]): void {
    this.returnOverrides[method] = value;
  }

  /**
   * Configure a method to throw an error when called.
   *
   * @param method - The method name to configure.
   * @param error  - The error to throw.
   */
  configureError<K extends keyof MethodErrorOverrides>(method: K, error: Error): void {
    this.errorOverrides[method] = error;
  }

  /**
   * Reset all recorded calls and configured overrides.
   * Call between tests to ensure test isolation.
   */
  /**
   * Seed OU data for a given parent path.
   * listOUs will return these when called with that parentPath (unless overridden).
   */
  seedOUs(parentPath: string, ous: WorkspaceOU[]): void {
    this.ouSeed.set(parentPath, ous);
  }

  reset(): void {
    this.calls.getUserOU = [];
    this.calls.listOUs = [];
    this.calls.createUser = [];
    this.calls.createOU = [];
    this.calls.suspendUser = [];
    this.calls.deleteUser = [];
    this.calls.listUsersInOU = [];
    this.returnOverrides = {};
    this.errorOverrides = {};
    this.ouSeed.clear();
  }

  // ---------------------------------------------------------------------------
  // Read methods
  // ---------------------------------------------------------------------------

  async getUserOU(email: string): Promise<string> {
    this.calls.getUserOU.push(email);
    if (this.errorOverrides.getUserOU) {
      throw this.errorOverrides.getUserOU;
    }
    return this.returnOverrides.getUserOU ?? '/League Staff';
  }

  async listOUs(parentPath: string): Promise<WorkspaceOU[]> {
    this.calls.listOUs.push(parentPath);
    if (this.errorOverrides.listOUs) {
      throw this.errorOverrides.listOUs;
    }
    if (this.returnOverrides.listOUs !== undefined) {
      return this.returnOverrides.listOUs;
    }
    return this.ouSeed.get(parentPath) ?? [];
  }

  // ---------------------------------------------------------------------------
  // Write methods
  // ---------------------------------------------------------------------------

  async createUser(params: CreateUserParams): Promise<CreatedUser> {
    this.calls.createUser.push(params);
    if (this.errorOverrides.createUser) {
      throw this.errorOverrides.createUser;
    }
    return (
      this.returnOverrides.createUser ?? {
        id: 'fake-gws-user-id',
        primaryEmail: params.primaryEmail,
      }
    );
  }

  async createOU(name: string): Promise<CreatedOU> {
    this.calls.createOU.push(name);
    if (this.errorOverrides.createOU) {
      throw this.errorOverrides.createOU;
    }
    return this.returnOverrides.createOU ?? { ouPath: '/Students/' + name };
  }

  async suspendUser(email: string): Promise<void> {
    this.calls.suspendUser.push(email);
    if (this.errorOverrides.suspendUser) {
      throw this.errorOverrides.suspendUser;
    }
  }

  async deleteUser(email: string): Promise<void> {
    this.calls.deleteUser.push(email);
    if (this.errorOverrides.deleteUser) {
      throw this.errorOverrides.deleteUser;
    }
  }

  async listUsersInOU(ouPath: string): Promise<WorkspaceUser[]> {
    this.calls.listUsersInOU.push(ouPath);
    if (this.errorOverrides.listUsersInOU) {
      throw this.errorOverrides.listUsersInOU;
    }
    return this.returnOverrides.listUsersInOU ?? [];
  }
}
