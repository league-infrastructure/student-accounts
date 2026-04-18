---
id: '004'
title: Test infrastructure ESM compatibility
status: done
use-cases:
- SUC-003
depends-on:
- '001'
- '002'
---

# Test infrastructure ESM compatibility

## Description

Verify and fix the test infrastructure after the ESM migration and
Prisma 7 upgrade. The test suite uses `ts-jest` with configs that extend
the server's tsconfig, which has changed from CommonJS to ESM.

### Changes

1. **`tests/server/tsconfig.json`**:
   - Extends `../../server/tsconfig.json` which now has ESM settings
   - May need to override `"module"` back to `"commonjs"` for ts-jest
     compatibility, OR configure ts-jest's ESM mode

2. **`tests/server/jest.config.js`**:
   - CJS config file (`module.exports`) — verify Jest can still load it
   - May need to update `ts-jest` transform configuration for ESM

3. **Verify all existing tests pass**:
   - `npm run test:server`
   - Check for import resolution issues
   - Check for Prisma client mock/initialization issues

## Acceptance Criteria

- [x] `npm run test:server` passes with zero failures (31/31 tests pass)
- [x] No new warnings related to ESM or module resolution
- [x] Test tsconfig correctly handles ESM server tsconfig inheritance

## Testing

- **Verification**: `npm run test:server` — all existing tests pass
