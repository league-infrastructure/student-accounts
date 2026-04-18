---
id: '001'
title: Server ESM migration and tsx replacement
status: done
use-cases:
- SUC-001
- SUC-003
depends-on: []
---

# Server ESM migration and tsx replacement

## Description

Migrate the Express server from CommonJS to ESM and replace `ts-node-dev`
with `tsx` for development hot-reload. This is a prerequisite for Prisma 7,
which generates ESM-only client code.

### Changes

1. **`server/package.json`**:
   - Add `"type": "module"`
   - Replace `ts-node-dev` with `tsx` in dependencies
   - Update dev script: `tsx watch src/index.ts`

2. **`server/tsconfig.json`**:
   - Change `"module": "commonjs"` → `"module": "ESNext"`
   - Add `"moduleResolution": "bundler"`

3. **`server/src/app.ts`**:
   - Replace `const path = require('path')` (~line 90) with
     `import path from 'path'` at the top of the file

4. **Verify all imports**: With `"moduleResolution": "bundler"`,
   existing extensionless relative imports should work. Scan for any
   other `require()` calls in `server/src/`.

## Acceptance Criteria

- [x] `server/package.json` has `"type": "module"`
- [x] `server/tsconfig.json` uses `"module": "ESNext"` and `"moduleResolution": "bundler"`
- [x] `ts-node-dev` replaced with `tsx` in server dependencies and scripts
- [x] No `require()` calls remain in `server/src/`
- [x] Server compiles with `tsc` without errors

## Testing

- **Existing tests to run**: `npm run test:server` (may need ticket 004 first)
- **Verification**: `cd server && npx tsc --noEmit` to verify compilation
