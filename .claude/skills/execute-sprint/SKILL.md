---
name: execute-sprint
description: Executes sprint tickets by creating Tasks for a team of programmer agents working in parallel worktrees
---

# Execute Sprint Skill

This skill executes all tickets in an active sprint. The team-lead
creates Tasks from tickets and spawns programmer teammates who work
in parallel using git worktrees.

## Inputs

- Active sprint with tickets in `todo` status
- Execution lock acquired (`acquire_execution_lock`)
- Sprint branch exists

## Process

### 1. Read Tickets

Read all tickets from the sprint's `tickets/` directory. Parse
frontmatter for status, dependencies, and ordering.

### 2. Order by Dependencies

Build a dependency graph from `depends-on` fields. Identify which
tickets can execute immediately (no unmet dependencies) and which
must wait.

### 3. Create Tasks

For each ticket, create a Task with:
- **Title**: Ticket title
- **Description**: Include:
  - Path to the ticket file
  - Path to the ticket plan (if separate)
  - Sprint ID and ticket ID
  - `scope_directory` for write constraints
  - Relevant architecture sections
  - Any dependency notes

Set Task dependencies matching ticket dependencies so programmers
can only claim unblocked tickets.

### 4. Spawn Programmer Teammates

Spawn programmer teammates using the `programmer` agent definition.
Each programmer:
- Claims a task
- Gets an isolated worktree branching off the sprint branch
  (e.g., `sprint/NNN-slug/ticket-001`)
- Reads the ticket file and plan from the task description
- Implements the ticket in their worktree
- Runs tests in their worktree
- Marks the task complete

The `TaskCompleted` hook validates completion:
- Tests pass in the worktree
- Acceptance criteria are met
- Ticket frontmatter is updated to `done`
- Worktree branch merges back to sprint branch

### 5. Monitor Progress

Monitor the task list for completion. Handle failures:
- If a programmer's task is blocked by merge conflicts, the
  `TaskCompleted` hook rejects and the programmer resolves conflicts
  in their worktree, re-runs tests, and retries.
- If a programmer fails after repeated attempts, escalate to the
  stakeholder.

After each programmer Task completes successfully:
1. Verify `status: done` is set in the ticket's frontmatter.
2. Call `move_ticket_to_done(ticket_path)` where `ticket_path` is the relative
   path: `docs/clasi/sprints/NNN-slug/tickets/NNN-slug.md`.
   This is a team-lead responsibility — the programmer sets the frontmatter;
   the team-lead moves the file.
3. Continue monitoring remaining tasks.

**Ticket completion is mandatory.** When a programmer completes a ticket,
its status must be set to `done` and `move_ticket_to_done` called.
There is no valid reason to leave a completed ticket in an incomplete
state. If the stakeholder says "leave it open", that means leave the
sprint open — the ticket itself must still be marked done.

### 6. Close Sprint

After all tasks complete:
1. Verify all tickets have `status: done`
2. Run the full test suite on the sprint branch
3. Present sprint summary to stakeholder
4. Invoke the `close-sprint` skill

## Fallback: Serial Execution

If agent teams are not available, fall back to serial execution:
for each ticket in dependency order, invoke the programmer agent
via the Agent tool (one at a time, no worktrees needed).

## Output

- All tickets implemented and marked done
- All tests passing on sprint branch
- Sprint ready for review and close
