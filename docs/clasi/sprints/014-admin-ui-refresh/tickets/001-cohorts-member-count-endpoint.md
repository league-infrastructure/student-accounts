---
id: "014-001"
title: "Cohorts endpoint — add member count"
status: todo
group: 1
depends_on: []
---

# Ticket 014-001: Cohorts Endpoint — Add Member Count

## Acceptance Criteria

- [ ] Cohorts endpoint includes `_count.users` in Prisma query
- [ ] Response exposes `memberCount: number` computed from `_count.users`
- [ ] Response type updated to include new field
- [ ] Unit tests verify member count is correct for each cohort
- [ ] Backward compatibility: existing clients continue to work (new field is added, not breaking)
- [ ] Manual verification: GET /api/admin/cohorts returns memberCount for each cohort

## Plan

### Approach

1. Find the cohorts route handler (likely `server/src/routes/admin/cohorts.ts`)
2. Locate the `prisma.cohort.findMany()` call
3. Add `include: { _count: { select: { users: true } } }` to the query
4. Map the response to expose `memberCount: number` (from `_count.users`)
5. Update the response type/interface if needed
6. Add unit tests to verify member counts
7. Test with curl/Postman to confirm response shape

### Files to Modify

- `server/src/routes/admin/cohorts.ts` (or equivalent)
- `server/src/types/*.ts` (if response type is defined separately)
- `tests/server/routes/admin/cohorts.test.ts` (or equivalent)

### Testing

**Unit Tests**:
- Test that memberCount is returned for each cohort
- Test that count matches actual number of members in each cohort
- Test with cohorts that have 0, 1, and many members

**Manual**:
1. Start dev server
2. GET /api/admin/cohorts
3. Verify each cohort has `memberCount: <number>`
4. Verify counts are accurate
5. Verify no 500 errors

### Notes

- No breaking changes; the new field is optional for clients
- Use the existing Prisma pattern for count aggregation (reference other endpoints if needed)
