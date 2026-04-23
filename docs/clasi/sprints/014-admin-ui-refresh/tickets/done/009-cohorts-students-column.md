---
id: 014-009
title: "Cohorts \u2014 students count column"
status: done
group: 5
depends_on:
- 014-001
---

# Ticket 014-009: Cohorts — Students Count Column

## Acceptance Criteria

- [ ] Students column added to cohorts table
- [ ] Column displays member count from backend (memberCount from Ticket 001)
- [ ] Counts are accurate and match actual group members
- [ ] Column header is "Students"
- [ ] Numbers are displayed as plain integers (no formatting needed)
- [ ] Component tests verify column is rendered and counts are displayed
- [ ] Manual verification: Cohorts page shows Students column with correct counts

## Plan

### Approach

1. Open `client/src/pages/admin/Cohorts.tsx`
2. Locate the cohorts table definition
3. Add a new column after the cohort name:
   - Header: "Students"
   - Cell: Display `memberCount` from the cohort object
   - Type: number
4. The backend (Ticket 001) returns `memberCount`, so frontend just displays it
5. Update component tests to verify column is rendered
6. Test manually in the browser

### Files to Modify

- `client/src/pages/admin/Cohorts.tsx`
- `tests/client/pages/admin/Cohorts.test.ts` (if needed)

### Testing

**Component Tests**:
- Verify Students column is rendered
- Verify memberCount is displayed for each cohort
- Verify no 404 or API errors

**Manual**:
1. Log in as admin and navigate to Cohorts
2. Verify Students column is visible (after cohort name column)
3. Verify numbers are displayed correctly for each cohort
4. Click on a cohort to view members
5. Manually count members and verify the displayed count matches
6. Verify page loads without errors (check Network and Console tabs)

### Notes

- This is a pure frontend change; backend (Ticket 001) provides the data
- No sorting or filtering of the column is required in this sprint
- If Cohorts table uses a column library (e.g., React Table), follow existing patterns
