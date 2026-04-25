---
status: done
---

# Plan: Real-Time Account Page Updates via SSE

## Context

Admin dashboard already has full SSE plumbing:
- `adminBus` (change-bus.ts) emits `'pending-requests'` / `'pending-users'`
- `GET /api/admin/events` streams those to admin browsers
- Student requests already fire `adminBus.notify('pending-requests')` → admin dashboard auto-updates

What's missing: when an admin **approves or rejects** something, the student's Account page
needs to update immediately. Currently the Account page only polls at 5 s when
`approvalStatus === 'pending'`, and is otherwise static between user actions.

## Approach: Add a user-scoped SSE endpoint mirroring the admin pattern

### 1. Extend `server/src/services/change-bus.ts`

Add a second bus for per-user events:

```ts
class UserChangeBus extends EventEmitter {
  notifyUser(userId: number): void {
    this.emit(`user-${userId}`);
  }
}
export const userBus = new UserChangeBus();
userBus.setMaxListeners(500);
```

### 2. Add `GET /api/account/events` SSE endpoint

New file: `server/src/routes/account-events.ts`

- Behind `requireAuth` (no role restriction — staff/admin with student sessions should also work)
- Reads `userId` from session
- Subscribes to `userBus` on `user-${userId}`
- Sends `event: account-updated\ndata: {}\n\n` on each event
- Heartbeat every 25 s (same as admin events)
- Cleans up on close/abort

Mount it in `server/src/routes/account.ts` or alongside it in the main router.

### 3. Fire `userBus.notifyUser(userId)` at every state-change for a student

| File | When | target userId |
|---|---|---|
| `server/src/routes/admin/provisioning-requests.ts` | approve or reject (already fires adminBus) | `existing.user_id` |
| `server/src/routes/admin/users.ts` | approve or deny pending account | the affected user's id |
| `server/src/routes/admin/llm-proxy.ts` (if exists) or llm-proxy route | grant or revoke token | the affected user's id |

### 4. Add `useAccountEventStream()` hook on the client

New file: `client/src/hooks/useAccountEventStream.ts`

```ts
export function useAccountEventStream() {
  const queryClient = useQueryClient();
  useEffect(() => {
    if (typeof EventSource === 'undefined') return;
    const source = new EventSource('/api/account/events');
    source.addEventListener('account-updated', () => {
      queryClient.invalidateQueries({ queryKey: ['account'] });
    });
    return () => source.close();
  }, [queryClient]);
}
```

### 5. Wire the hook into `client/src/pages/Account.tsx`

Call `useAccountEventStream()` near the top of the Account component.

Also remove the conditional `refetchInterval: 5000` (or keep it as a fallback safety net
— it's harmless but redundant once SSE is live).

## Files to change

| File | Change |
|---|---|
| `server/src/services/change-bus.ts` | Add `UserChangeBus` class + `userBus` export |
| `server/src/routes/account.ts` | Mount the account-events route (or add inline) |
| `server/src/routes/account-events.ts` | **New** SSE endpoint |
| `server/src/routes/admin/provisioning-requests.ts` | Fire `userBus.notifyUser(userId)` on approve/reject |
| `server/src/routes/admin/users.ts` | Fire `userBus.notifyUser(userId)` on approve/deny |
| Any admin route that grants/revokes LLM proxy | Fire `userBus.notifyUser(userId)` |
| `client/src/hooks/useAccountEventStream.ts` | **New** hook |
| `client/src/pages/Account.tsx` | Call `useAccountEventStream()` |

## Verification

1. Log in as a student, go to Account page
2. Open admin dashboard in another tab/browser
3. Student submits a provisioning request → admin dashboard should update immediately (already works)
4. Admin approves the request → student Account page should update without refresh
5. Admin grants LLM proxy token → student Account page should update
6. Admin approves/denies a pending account → student Account page should update
