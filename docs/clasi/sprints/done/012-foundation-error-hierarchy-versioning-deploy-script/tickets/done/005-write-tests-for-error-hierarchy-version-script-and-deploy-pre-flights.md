---
id: '005'
title: Write tests for error hierarchy, version script, and deploy pre-flights
status: done
use-cases:
- SUC-001
- SUC-002
- SUC-003
depends-on:
- '001'
- '002'
- '003'
- '004'
---

# Write tests for error hierarchy, version script, and deploy pre-flights

## Description

Write server tests for the error hierarchy (each error type returns correct
HTTP status via the middleware), verify services throw typed errors, and
test the version script output format.

## Acceptance Criteria

- [ ] Tests verify NotFoundError → 404, ValidationError → 400, UnauthorizedError → 401, ForbiddenError → 403, ConflictError → 409
- [ ] Tests verify unknown errors → 500 with generic message
- [ ] Tests verify error handler returns `{ error: message }` JSON format
- [ ] Tests verify services throw typed errors for known error conditions
- [ ] All tests pass: `npm run test:server`

## Testing

- **Existing tests to run**: `npm run test:server`
- **New tests to write**: `tests/server/errors.test.ts`
- **Verification command**: `npm run test:server`
