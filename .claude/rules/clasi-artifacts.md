---
paths:
  - docs/clasi/**
---

You are modifying CLASI planning artifacts. Before making changes:

1. Confirm you have an active sprint (`list_sprints(status="active")`),
   or the stakeholder said "out of process" / "direct change".
2. If creating or modifying tickets, the sprint must be in `ticketing`
   or `executing` phase (`get_sprint_phase(sprint_id)`).
3. Use CLASI MCP tools for all artifact operations — do not create
   sprint/ticket/TODO files manually.

Direct edits to `docs/clasi/sprints/` are blocked for team-lead. Use MCP tools.
