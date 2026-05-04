---
id: '003'
title: Client Send-test button on Account page
status: done
use-cases:
- SUC-001
depends-on:
- '002'
github-issue: ''
todo: ''
completes_todo: true
---
<!-- CLASI: Before changing code or making plans, review the SE process in CLAUDE.md -->

# Client Send-test button on Account page

## Description

Add a "Send test" button to the `ProfileSection` of `client/src/pages/Account.tsx`, positioned
next to or immediately below the notification-email picker. The button POSTs to
`/api/account/test-email` with the currently selected notification email and displays a
transient success/error pill for approximately 5 seconds.

**Depends on ticket 002** — the endpoint must exist.

## Acceptance Criteria

- [x] "Send test" button is visible in `ProfileSection` adjacent to the notification-email picker.
- [x] Button is disabled while the POST is in-flight (prevents double-submit).
- [x] On success: green pill "Test email sent to \<addr\>" appears and auto-clears after ~5 s.
- [x] On error: red pill with the server's error message appears and auto-clears after ~5 s.
- [x] The POST body includes the currently selected notification email (or falls back gracefully if none selected).
- [x] No permanent state is added — pill disappears, button re-enables after completion.
- [x] Client tests pass (see Testing Plan).

## Implementation Plan

### Approach

In `client/src/pages/Account.tsx`, within the `ProfileSection` component:

1. Add state: `const [testEmailStatus, setTestEmailStatus] = useState<{ ok: boolean; msg: string } | null>(null)`.
2. Add state: `const [testEmailBusy, setTestEmailBusy] = useState(false)`.
3. Add handler `sendTestEmail()`:
   - Set `testEmailBusy = true`.
   - POST to `/api/account/test-email` with `{ to: <currently selected notification email> }`.
   - On success: `setTestEmailStatus({ ok: true, msg: 'Test email sent to <to>' })`.
   - On error: `setTestEmailStatus({ ok: false, msg: data.error })`.
   - Set `testEmailBusy = false`.
   - Schedule `setTimeout(() => setTestEmailStatus(null), 5000)`.
4. Render: next to the notification-email picker, add:
   ```tsx
   <button onClick={sendTestEmail} disabled={testEmailBusy} style={...}>
     Send test
   </button>
   {testEmailStatus && (
     <span style={{ color: testEmailStatus.ok ? '#065f46' : '#991b1b', ... }}>
       {testEmailStatus.msg}
     </span>
   )}
   ```

### Files to Modify

- `client/src/pages/Account.tsx` — add button + state + handler to `ProfileSection`

### Testing Plan

In `tests/client/pages/Account.test.tsx` (or the relevant test file for `Account.tsx`):
- Mock `fetch` or use MSW to stub `POST /api/account/test-email`.
- Test: clicking "Send test" calls POST with the selected notification email.
- Test: on success response, green pill with correct message renders.
- Test: on error response, red pill with server error message renders.
- Test: button is disabled while in-flight (set fetch to pending, assert `disabled`).
- Test: pill disappears after 5 s (use `jest.useFakeTimers()` and advance by 5001 ms).

Run: `npm run test:client -- Account`
