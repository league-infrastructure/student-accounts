---
paths:
  - clasi/**
  - tests/**
---

You are modifying source code or tests. Before writing code:

1. You must have a ticket in `in-progress` status, or the stakeholder
   said "out of process".
2. If you have a ticket, follow the execute-ticket skill — call
   `get_skill_definition("execute-ticket")` if unsure of the steps.
3. Run tests after changes: `uv run pytest`.
