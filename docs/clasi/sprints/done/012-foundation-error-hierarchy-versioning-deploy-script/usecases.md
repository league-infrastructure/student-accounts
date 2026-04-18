---
status: draft
---

# Sprint 012 Use Cases

## SUC-001: Typed Error Responses
Parent: Infrastructure

- **Actor**: API consumer (client app or external caller)
- **Preconditions**: Server is running, service layer handles requests
- **Main Flow**:
  1. Client sends a request that triggers an error condition in a service
  2. Service throws a typed ServiceError subclass (e.g., NotFoundError)
  3. Error propagates to the error handler middleware
  4. Middleware detects ServiceError, extracts statusCode and message
  5. Middleware returns JSON response with correct HTTP status and error message
- **Postconditions**: Client receives a structured `{ error: "..." }` response with the appropriate HTTP status code; no stack traces are leaked
- **Acceptance Criteria**:
  - [ ] NotFoundError returns 404
  - [ ] ValidationError returns 400
  - [ ] UnauthorizedError returns 401
  - [ ] ForbiddenError returns 403
  - [ ] ConflictError returns 409
  - [ ] Unknown errors return 500 without stack trace

## SUC-002: Version Tagging and Health Exposure
Parent: Infrastructure

- **Actor**: Developer or operator
- **Preconditions**: Git repository with commit history
- **Main Flow**:
  1. Developer runs `npm run version:tag`
  2. Script calculates today's date and next sequence number
  3. Script creates annotated git tag `v0.YYYYMMDD.N`
  4. Health endpoint includes the version from the latest tag or APP_VERSION env var
- **Postconditions**: HEAD is tagged with a date-based version; health endpoint reports it
- **Acceptance Criteria**:
  - [ ] `scripts/version.sh` outputs `0.YYYYMMDD.N` format
  - [ ] Sequential runs on the same day increment N
  - [ ] Health endpoint returns `version` field
  - [ ] APP_VERSION env var overrides tag-based detection

## SUC-003: Safe Production Deployment
Parent: Infrastructure

- **Actor**: Developer deploying to production
- **Preconditions**: Code is committed, tagged, and ready to deploy
- **Main Flow**:
  1. Developer runs `npm run deploy`
  2. Script validates: clean tree, correct branch, version tag, Docker, env vars
  3. If any check fails, script prints clear error and exits
  4. If all pass, script builds Docker image, pushes to registry, deploys stack, runs migrations
- **Postconditions**: New version is deployed to Docker Swarm with migrations applied
- **Acceptance Criteria**:
  - [ ] Dirty working tree is rejected
  - [ ] Non-main branch is rejected
  - [ ] Missing version tag is rejected
  - [ ] Missing APP_DOMAIN is rejected
  - [ ] Successful deploy builds, pushes, deploys, and migrates
