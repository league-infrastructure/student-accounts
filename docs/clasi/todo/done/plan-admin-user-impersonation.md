---
status: done
sprint: 018
tickets:
- 018-007
- 018-008
- 018-009
---

# Plan: Admin User Impersonation

## Context

Admins need to impersonate other users to debug issues and see the app from their perspective. The server-side middleware (`server/src/middleware/impersonate.ts`) already exists but is not wired up. We need to integrate it, add API endpoints, update the admin UI with an "Impersonate" button, and show impersonation state in the account dropdown.

## Changes

### 1. Wire up impersonate middleware in app.ts
- **File:** `server/src/app.ts` (~line 93)
- Import and add `impersonateMiddleware` right after `passport.session()` (before routes)

### 2. Update requireAdmin to respect impersonation
- **File:** `server/src/middleware/requireAdmin.ts`
- When `req.realAdmin` exists (impersonating), check the real admin's role instead of `req.user`
- This allows admins to still access admin routes while impersonating a non-admin

### 3. Add impersonation API endpoints
- **File:** `server/src/routes/admin/users.ts`
- `POST /admin/users/:id/impersonate` — sets `req.session.impersonatingUserId` and `realAdminId`, returns success
  - Validate target user exists, prevent self-impersonation
- `POST /admin/stop-impersonating` — clears session fields, returns success

### 4. Surface impersonation state in /api/auth/me
- **File:** `server/src/routes/auth.ts` (~line 230)
- Add `impersonating: boolean` and `realAdmin: { id, displayName }` fields to the response when impersonating

### 5. Add "Impersonate" button to UsersPanel
- **File:** `client/src/pages/admin/UsersPanel.tsx`
- Add an "Actions" column with an "Impersonate" button per row
- Skip showing the button for the current user's own row
- On click: `POST /api/admin/users/:id/impersonate`, then reload the page (to refresh all user-dependent state)

### 6. Update account dropdown for impersonation state
- **File:** `client/src/components/AppLayout.tsx` (~line 384)
- When `user.impersonating` is true:
  - Show a colored banner/indicator (e.g., "Viewing as: {displayName}")
  - Replace "Log out" with "Stop impersonating" button
  - "Stop impersonating" calls `POST /api/admin/stop-impersonating`, then reloads the page

## Verification
1. Log in as admin, go to Admin > Users
2. Click "Impersonate" on a non-admin user
3. Verify: app behaves as that user (nav, data, role badge)
4. Verify: dropdown shows "Stop impersonating" instead of "Log out"
5. Verify: admin routes still work (admin can navigate back to admin panel)
6. Click "Stop impersonating" — verify return to admin identity
7. Run existing tests to check nothing is broken


---

## Hook Debug Info

```json
{
  "hook_payload": {
    "session_id": "dac9470d-2467-45a0-bd31-498e42671071",
    "transcript_path": "/Users/eric/.claude/projects/-Users-eric-proj-scratch-student-progress-report/dac9470d-2467-45a0-bd31-498e42671071.jsonl",
    "cwd": "/Users/eric/proj/scratch/student-progress-report",
    "permission_mode": "acceptEdits",
    "hook_event_name": "PostToolUse",
    "tool_name": "ExitPlanMode",
    "tool_input": {
      "allowedPrompts": [
        {
          "tool": "Bash",
          "prompt": "run tests"
        }
      ],
      "plan": "# Plan: Admin User Impersonation\n\n## Context\n\nAdmins need to impersonate other users to debug issues and see the app from their perspective. The server-side middleware (`server/src/middleware/impersonate.ts`) already exists but is not wired up. We need to integrate it, add API endpoints, update the admin UI with an \"Impersonate\" button, and show impersonation state in the account dropdown.\n\n## Changes\n\n### 1. Wire up impersonate middleware in app.ts\n- **File:** `server/src/app.ts` (~line 93)\n- Import and add `impersonateMiddleware` right after `passport.session()` (before routes)\n\n### 2. Update requireAdmin to respect impersonation\n- **File:** `server/src/middleware/requireAdmin.ts`\n- When `req.realAdmin` exists (impersonating), check the real admin's role instead of `req.user`\n- This allows admins to still access admin routes while impersonating a non-admin\n\n### 3. Add impersonation API endpoints\n- **File:** `server/src/routes/admin/users.ts`\n- `POST /admin/users/:id/impersonate` \u2014 sets `req.session.impersonatingUserId` and `realAdminId`, returns success\n  - Validate target user exists, prevent self-impersonation\n- `POST /admin/stop-impersonating` \u2014 clears session fields, returns success\n\n### 4. Surface impersonation state in /api/auth/me\n- **File:** `server/src/routes/auth.ts` (~line 230)\n- Add `impersonating: boolean` and `realAdmin: { id, displayName }` fields to the response when impersonating\n\n### 5. Add \"Impersonate\" button to UsersPanel\n- **File:** `client/src/pages/admin/UsersPanel.tsx`\n- Add an \"Actions\" column with an \"Impersonate\" button per row\n- Skip showing the button for the current user's own row\n- On click: `POST /api/admin/users/:id/impersonate`, then reload the page (to refresh all user-dependent state)\n\n### 6. Update account dropdown for impersonation state\n- **File:** `client/src/components/AppLayout.tsx` (~line 384)\n- When `user.impersonating` is true:\n  - Show a colored banner/indicator (e.g., \"Viewing as: {displayName}\")\n  - Replace \"Log out\" with \"Stop impersonating\" button\n  - \"Stop impersonating\" calls `POST /api/admin/stop-impersonating`, then reloads the page\n\n## Verification\n1. Log in as admin, go to Admin > Users\n2. Click \"Impersonate\" on a non-admin user\n3. Verify: app behaves as that user (nav, data, role badge)\n4. Verify: dropdown shows \"Stop impersonating\" instead of \"Log out\"\n5. Verify: admin routes still work (admin can navigate back to admin panel)\n6. Click \"Stop impersonating\" \u2014 verify return to admin identity\n7. Run existing tests to check nothing is broken\n",
      "planFilePath": "/Users/eric/.claude/plans/quiet-finding-wilkinson.md"
    },
    "tool_response": {
      "plan": "# Plan: Admin User Impersonation\n\n## Context\n\nAdmins need to impersonate other users to debug issues and see the app from their perspective. The server-side middleware (`server/src/middleware/impersonate.ts`) already exists but is not wired up. We need to integrate it, add API endpoints, update the admin UI with an \"Impersonate\" button, and show impersonation state in the account dropdown.\n\n## Changes\n\n### 1. Wire up impersonate middleware in app.ts\n- **File:** `server/src/app.ts` (~line 93)\n- Import and add `impersonateMiddleware` right after `passport.session()` (before routes)\n\n### 2. Update requireAdmin to respect impersonation\n- **File:** `server/src/middleware/requireAdmin.ts`\n- When `req.realAdmin` exists (impersonating), check the real admin's role instead of `req.user`\n- This allows admins to still access admin routes while impersonating a non-admin\n\n### 3. Add impersonation API endpoints\n- **File:** `server/src/routes/admin/users.ts`\n- `POST /admin/users/:id/impersonate` \u2014 sets `req.session.impersonatingUserId` and `realAdminId`, returns success\n  - Validate target user exists, prevent self-impersonation\n- `POST /admin/stop-impersonating` \u2014 clears session fields, returns success\n\n### 4. Surface impersonation state in /api/auth/me\n- **File:** `server/src/routes/auth.ts` (~line 230)\n- Add `impersonating: boolean` and `realAdmin: { id, displayName }` fields to the response when impersonating\n\n### 5. Add \"Impersonate\" button to UsersPanel\n- **File:** `client/src/pages/admin/UsersPanel.tsx`\n- Add an \"Actions\" column with an \"Impersonate\" button per row\n- Skip showing the button for the current user's own row\n- On click: `POST /api/admin/users/:id/impersonate`, then reload the page (to refresh all user-dependent state)\n\n### 6. Update account dropdown for impersonation state\n- **File:** `client/src/components/AppLayout.tsx` (~line 384)\n- When `user.impersonating` is true:\n  - Show a colored banner/indicator (e.g., \"Viewing as: {displayName}\")\n  - Replace \"Log out\" with \"Stop impersonating\" button\n  - \"Stop impersonating\" calls `POST /api/admin/stop-impersonating`, then reloads the page\n\n## Verification\n1. Log in as admin, go to Admin > Users\n2. Click \"Impersonate\" on a non-admin user\n3. Verify: app behaves as that user (nav, data, role badge)\n4. Verify: dropdown shows \"Stop impersonating\" instead of \"Log out\"\n5. Verify: admin routes still work (admin can navigate back to admin panel)\n6. Click \"Stop impersonating\" \u2014 verify return to admin identity\n7. Run existing tests to check nothing is broken\n",
      "isAgent": false,
      "filePath": "/Users/eric/.claude/plans/quiet-finding-wilkinson.md",
      "planWasEdited": true
    },
    "tool_use_id": "toolu_0121fwWrQoLy7729Qg17CoJp"
  },
  "env": {
    "TOOL_INPUT": "",
    "TOOL_NAME": "",
    "SESSION_ID": "",
    "CLASI_AGENT_TIER": "",
    "CLASI_AGENT_NAME": "",
    "CLAUDE_PROJECT_DIR": "/Users/eric/proj/scratch/student-progress-report",
    "PWD": "/Users/eric/proj/scratch/student-progress-report",
    "CWD": ""
  },
  "plans_dir": "/Users/eric/.claude/plans",
  "plan_file": "/Users/eric/.claude/plans/quiet-finding-wilkinson.md",
  "cwd": "/Users/eric/proj/scratch/student-progress-report"
}
```
