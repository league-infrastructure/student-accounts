---
id: "014-002"
title: "Group members endpoint — add LLM proxy status"
status: todo
group: 1
depends_on: []
---

# Ticket 014-002: Group Members Endpoint — Add LLM Proxy Status

## Acceptance Criteria

- [ ] GET /api/admin/groups/:id/members includes `llmProxyToken` status per member
- [ ] Status computed correctly: active (non-null, valid), pending, or none
- [ ] Response type updated to include new field
- [ ] Unit tests verify proxy status is correct for each member state
- [ ] Backward compatibility: existing clients continue to work
- [ ] Manual verification: GET /api/admin/groups/:id/members shows proxy status

## Plan

### Approach

1. Find the group members endpoint handler
2. For each member in the response, compute and include `llmProxyToken` status
3. Proxy status logic:
   - If member has an LLM proxy token AND it's valid/active → "active"
   - If member has a pending proxy request → "pending"
   - Otherwise → "none"
4. Update response type to include the new field
5. Add unit tests to verify status computation
6. Test with manual curl/Postman to confirm response shape

### Files to Modify

- `server/src/routes/admin/groups.ts` (or equivalent)
- `server/src/services/*.ts` (if member assembly is in a service)
- `server/src/types/*.ts` (if response type is defined separately)
- `tests/server/routes/admin/groups.test.ts` (or equivalent)

### Testing

**Unit Tests**:
- Test member with active proxy token → "active"
- Test member with pending proxy request → "pending"
- Test member with no proxy → "none"
- Test mixed members in one group

**Manual**:
1. Start dev server
2. Create/select a group with multiple members in different proxy states
3. GET /api/admin/groups/:id/members
4. Verify each member has `llmProxyToken` with correct status
5. Verify status matches actual proxy state

### Notes

- Reference existing proxy token model/schema to understand the data structure
- Proxy status should be read-only; no changes to mutations in this ticket
