---
id: '004'
title: Add GET /api/staff/directory route with requireRole(staff) guard
status: done
use-cases:
- SUC-009-007
depends-on: []
github-issue: ''
todo: ''
---

# Add GET /api/staff/directory route with requireRole(staff) guard

## Description

Staff users need a read-only student listing. This ticket creates a new
`staffDirectoryRouter` mounted at `/api/staff` in `app.ts`. It returns all
active students with cohort and external account type information. No write
endpoints are exposed. Any non-staff user receives 403.

## Acceptance Criteria

- [x] `GET /api/staff/directory` returns all active Users with `role=student`.
- [x] Response per user: `{ id, displayName, email, cohort: {id,name}|null,
      externalAccountTypes: string[] }`. No login details, no provisioning
      fields, no audit fields.
- [x] Returns 403 for `role=admin` and `role=student` users (staff-only).
      Note: admin users may be allowed for testing convenience — confirm with
      stakeholder; default to staff-only.
- [x] Returns 401 for unauthenticated requests.
- [x] Router is mounted in `server/src/app.ts` under `/api` (not under
      `adminRouter`).
- [x] No write endpoints exist on `staffDirectoryRouter` — any POST/PUT/DELETE
      to `/api/staff/*` returns 404.
- [x] Server tests cover: staff user can list students; student user is blocked
      (403); unauthenticated is blocked (401).

## Implementation Plan

**Files to create:**
- `server/src/routes/staff/directory.ts` — new `staffDirectoryRouter`.

**Files to modify:**
- `server/src/app.ts` — mount `staffDirectoryRouter` under `/api`.

**Router sketch:**
```typescript
import { Router } from 'express';
import { prisma } from '../../services/prisma.js';
import { requireAuth } from '../../middleware/requireAuth.js';
import { requireRole } from '../../middleware/requireRole.js';

export const staffDirectoryRouter = Router();

staffDirectoryRouter.get(
  '/staff/directory',
  requireAuth,
  requireRole('staff'),
  async (req, res, next) => {
    try {
      const users = await prisma.user.findMany({
        where: { is_active: true, role: 'student' },
        orderBy: { display_name: 'asc' },
        include: {
          cohort: { select: { id: true, name: true } },
          external_accounts: { select: { type: true } },
        },
      });
      res.json(users.map(u => ({
        id: u.id,
        displayName: u.display_name,
        email: u.primary_email,
        cohort: u.cohort ? { id: u.cohort.id, name: u.cohort.name } : null,
        externalAccountTypes: [...new Set(u.external_accounts.map(a => a.type))],
      })));
    } catch (err) { next(err); }
  }
);
```

**Testing plan:**
- New test file: `tests/server/staff/directory.test.ts`
- Cases: staff user receives 200 with student list; student user receives 403;
  unauthenticated receives 401.

**Documentation updates:** None required.
