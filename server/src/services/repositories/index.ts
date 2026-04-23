/**
 * Barrel export for all repository modules.
 * Import from this file in services and tests.
 */
export type { DbClient } from './types.js';

export { CohortRepository } from './cohort.repository.js';
export type { CreateCohortInput, UpdateCohortInput } from './cohort.repository.js';

export { UserRepository } from './user.repository.js';
export type { CreateUserInput, UpdateUserInput, FindAllUsersFilter } from './user.repository.js';

export { LoginRepository } from './login.repository.js';
export type { CreateLoginInput } from './login.repository.js';

export { ExternalAccountRepository } from './external-account.repository.js';
export type { CreateExternalAccountInput } from './external-account.repository.js';

export { AuditEventRepository } from './audit-event.repository.js';
export type { CreateAuditEventInput } from './audit-event.repository.js';

export { ProvisioningRequestRepository } from './provisioning-request.repository.js';
export type { CreateProvisioningRequestInput } from './provisioning-request.repository.js';

export { MergeSuggestionRepository } from './merge-suggestion.repository.js';
export type { CreateMergeSuggestionInput } from './merge-suggestion.repository.js';

export { GroupRepository } from './group.repository.js';
export type {
  CreateGroupInput,
  UpdateGroupInput,
  UserSearchMatch,
  UserSearchResult,
  GroupWithMemberCount,
  MemberRow,
} from './group.repository.js';

export { LlmProxyTokenRepository } from './llm-proxy-token.repository.js';
export type { CreateLlmProxyTokenInput } from './llm-proxy-token.repository.js';
