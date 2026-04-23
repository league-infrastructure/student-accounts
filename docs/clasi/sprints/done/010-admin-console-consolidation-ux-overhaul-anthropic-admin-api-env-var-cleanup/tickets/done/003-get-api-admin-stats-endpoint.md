---
id: '003'
title: GET /api/admin/stats endpoint
status: done
use-cases:
  - SUC-010-005
depends-on: []
github-issue: ''
todo: plan-admin-ux-overhaul-dashboard-route-split-user-detail-account-lifecycle.md
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# GET /api/admin/stats endpoint

## Description

The admin Dashboard (T010) needs aggregate counts to populate its role-count
cards. Create a new `GET /api/admin/stats` endpoint that returns these counts
in a single Prisma aggregation. No external API calls.

## Acceptance Criteria

- [x] `server/src/routes/admin/stats.ts` created and exports `adminStatsRouter`.
- [x] `GET /admin/stats` returns `{ totalStudents, totalStaff, totalAdmins, pendingRequests, openMergeSuggestions, cohortCount }` (all integers).
- [x] Endpoint is protected by `requireAuth` + `requireRole('admin')` (enforced by `adminRouter` mount — confirm this is automatic via the existing `adminRouter` setup).
- [x] `adminStatsRouter` is mounted in `server/src/routes/admin/index.ts`.
- [x] Route-level test for `GET /admin/stats` covering: 200 with correct shape; 403 for non-admin user.
- [x] `npm run test:server` passes.

## Implementation Plan

### New Files

**`server/src/routes/admin/stats.ts`**

Single route handler. Implementation:
```
const [students, staff, admins, pendingRequests, openMergeSuggestions, cohortCount] =
  await Promise.all([
    prisma.user.count({ where: { role: 'student', is_active: true } }),
    prisma.user.count({ where: { role: 'staff', is_active: true } }),
    prisma.user.count({ where: { role: 'admin', is_active: true } }),
    prisma.provisioningRequest.count({ where: { status: 'pending' } }),
    prisma.mergeSuggestion.count({ where: { status: 'pending' } }),
    prisma.cohort.count(),
  ]);
return res.json({ totalStudents: students, totalStaff: staff, totalAdmins: admins,
  pendingRequests, openMergeSuggestions, cohortCount });
```

Before writing, grep the schema for exact model/field names: `ProvisioningRequest`,
`MergeSuggestion`, `Cohort`, `User` with `role` and `is_active` fields.

### Files to Modify

**`server/src/routes/admin/index.ts`**
- Import `adminStatsRouter` and mount with `adminRouter.use('/admin', adminStatsRouter)` (or check the existing mount pattern for consistency).

### Testing Plan

**New test:** `tests/server/routes/admin/stats.test.ts`
- Seed: 3 students, 1 staff, 1 admin, 2 pending requests, 1 open merge suggestion, 2 cohorts.
- Assert response shape and values.
- Assert 403 when called as a student.

Run `npm run test:server`.
