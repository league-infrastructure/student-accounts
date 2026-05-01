---
status: approved
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Sprint 017 Use Cases

## SUC-017-001: Capture raw OAuth payload on every sign-in

- **Actor**: System (signInHandler)
- **Preconditions**: A user signs in via Google, GitHub, or Pike13.
- **Main Flow**:
  1. The OAuth callback receives a profile from the provider.
  2. `signInHandler` upserts the `Login` row.
  3. The raw profile (full JSON) is written to `Login.provider_payload`; `provider_payload_updated_at` is set to now.
  4. A new `LoginEvent` row is appended with `payload`, `ip`, `user_agent`.
- **Postconditions**: The Login row reflects the most recent provider profile. A LoginEvent row exists for this sign-in.
- **Acceptance Criteria**:
  - [ ] `provider_payload` is non-null after a fresh sign-in.
  - [ ] `provider_payload_updated_at` reflects the time of the latest sign-in.
  - [ ] One `LoginEvent` row per sign-in event.

## SUC-017-002: Enrich Google staff sign-ins with directory metadata

- **Actor**: System (signInHandler, Google admin client)
- **Preconditions**: A user with an `@jointheleague.org` email signs in via Google. The Google admin client is configured.
- **Main Flow**:
  1. signInHandler reaches the Step 4 `@jointheleague.org` branch.
  2. The OU lookup is performed (existing behavior).
  3. `GoogleWorkspaceAdminClientImpl.listUserGroups(email)` is called.
  4. The OU and groups are combined into `{ ou_path, groups }` and written to `Login.directory_metadata`.
- **Postconditions**: `Login.directory_metadata` contains `{ ou_path, groups }` for the staff user.
- **Acceptance Criteria**:
  - [ ] After staff sign-in, `directory_metadata` is set.
  - [ ] If `listUserGroups` throws, sign-in still succeeds; `directory_metadata` may be partial or null.
  - [ ] Non-Google sign-ins leave `directory_metadata` null.

## SUC-017-003: Read login provenance via typed accessors

- **Actor**: Server code that needs to inspect a Login's provider data
- **Preconditions**: A Login row may have `provider_payload` and/or `directory_metadata` populated.
- **Main Flow**:
  1. Caller imports `getGoogleGroups`, `getGoogleOu`, `getGitHubLogin`, etc. from `login-payload.ts`.
  2. Caller passes a `Login` row.
  3. The helper returns the typed value (string, array, or null).
- **Postconditions**: Caller has typed access without re-implementing JSON parsing.
- **Acceptance Criteria**:
  - [ ] Each helper returns `null` when the underlying field is absent.
  - [ ] Each helper returns the correct typed value when the field is populated.
  - [ ] No production code accesses `provider_payload` or `directory_metadata` directly — all reads go through `login-payload.ts`.
