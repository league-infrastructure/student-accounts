---
id: "014-003"
title: "Group bulk-action routes — accept userIds filter"
status: todo
group: 1
depends_on: []
---

# Ticket 014-003: Group Bulk-Action Routes — Accept userIds Filter

## Acceptance Criteria

- [ ] Bulk-action endpoints accept optional `userIds?: string[]` in request body
- [ ] When userIds is provided, Prisma query filters to only those users within the group
- [ ] When userIds is omitted, original behavior (all group members)
- [ ] Affected endpoints: bulk-provision, bulk-suspend-all, bulk-remove-all, llm-proxy/bulk-grant, llm-proxy/bulk-revoke
- [ ] Request validation ensures userIds are valid UUIDs and belong to the group
- [ ] Unit tests verify filtering works correctly with and without userIds
- [ ] Backward compatibility: existing clients (omitting userIds) work unchanged
- [ ] Manual verification: Bulk action with userIds affects only selected users

## Plan

### Approach

1. Find all bulk-action endpoint handlers (bulk-provision, bulk-suspend-all, bulk-remove-all, llm-proxy/bulk-grant, llm-proxy/bulk-revoke)
2. Update request body type to include `userIds?: string[]`
3. For each endpoint, add conditional Prisma filter:
   ```typescript
   const where = {
     groupId: groupId,
     ...(userIds && { userId: { in: userIds } })
   };
   ```
4. Add validation to ensure provided userIds belong to the group
5. Update endpoint documentation/comments to explain userIds parameter
6. Add unit tests for each endpoint with and without userIds
7. Test manually with curl/Postman

### Files to Modify

- `server/src/routes/admin/groups.ts` (or equivalent)
- `server/src/services/*.ts` (if bulk actions are in services)
- `tests/server/routes/admin/groups.test.ts` (or equivalent)

### Testing

**Unit Tests** (for each bulk-action endpoint):
- Test without userIds: action affects all group members
- Test with userIds: action affects only specified users
- Test with invalid userIds: validation fails
- Test with userIds from different group: validation fails
- Test with empty userIds array: action affects no members

**Manual**:
1. Start dev server
2. Create a group with multiple members
3. Call bulk-action endpoint with userIds filter
4. Verify only selected members are affected
5. Call bulk-action endpoint without userIds
6. Verify all members are affected
7. Test error case: userIds with user not in group

### Notes

- Use existing Prisma patterns for conditional filters
- Ensure validation prevents cross-group user access
- Document the optional parameter clearly
