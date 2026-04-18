---
id: '002'
title: Migrate existing services to throw typed ServiceErrors
status: done
use-cases:
- SUC-001
depends-on:
- '001'
---

# Migrate existing services to throw typed ServiceErrors

## Description

Update existing services (UserService, ChannelService, MessageService, etc.)
to throw typed ServiceError subclasses instead of raw errors or returning null.
Update route handlers to remove unnecessary try/catch blocks where the error
handler middleware can now handle errors automatically.

## Acceptance Criteria

- [ ] UserService throws NotFoundError for missing users
- [ ] UserService throws ConflictError for duplicate emails
- [ ] Other services throw appropriate typed errors for error conditions
- [ ] Route handlers are simplified where try/catch is no longer needed
- [ ] All existing tests continue to pass

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: Covered in ticket #005
- **Verification command**: `npm run test:server`
