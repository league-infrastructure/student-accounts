---
id: '001'
title: Create ServiceError class hierarchy and update error handler middleware
status: done
use-cases:
- SUC-001
depends-on: []
---

# Create ServiceError class hierarchy and update error handler middleware

## Description

Create `server/src/errors.ts` with a base `ServiceError` class and subclasses
for common HTTP error codes (400, 401, 403, 404, 409). Update the existing
error handler middleware to detect `ServiceError` instances and return the
correct HTTP status code with a JSON error message.

## Acceptance Criteria

- [ ] `server/src/errors.ts` exports ServiceError, NotFoundError, ValidationError, UnauthorizedError, ForbiddenError, ConflictError
- [ ] Each error class sets the correct statusCode (404, 400, 401, 403, 409)
- [ ] Error handler middleware returns `{ error: message }` with correct HTTP status for ServiceError instances
- [ ] Unknown errors return 500 with generic message (no stack trace leakage)

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: Covered in ticket #005
- **Verification command**: `npm run test:server`
