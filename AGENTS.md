# Agent Instructions

All agent instructions are maintained in [CLAUDE.md](CLAUDE.md).
Refer to that file for documentation references, external tool usage
(dotconfig, rundbat, clasi), testing requirements, and the SE process.

<!-- CLASI:START -->
## CLASI Software Engineering Process

This project uses the **CLASI** (Claude Agent Skills Instructions)
software engineering process, managed via an MCP server.

**The SE process is the default.** When asked to build a feature, fix a
bug, or make any code change, follow this process unless the stakeholder
explicitly says "out of process" or "direct change".

### Process

Work flows through four stages organized into sprints:

1. **Requirements** — Elicit requirements, produce overview and use cases
2. **Architecture** — Produce technical plan
3. **Ticketing** — Break plan into actionable tickets
4. **Implementation** — Execute tickets

Use `/se` or call `get_se_overview()` for full process details and MCP
tool reference.

### Stakeholder Corrections

When the stakeholder corrects your behavior or expresses frustration
("that's wrong", "why did you do X?", "I told you to..."):

1. Acknowledge the correction immediately.
2. Run `get_skill_definition("self-reflect")` to produce a structured
   reflection in `docs/plans/reflections/`.
3. Continue with the corrected approach.

Do NOT trigger on simple clarifications, new instructions, or questions
about your reasoning.
<!-- CLASI:END -->
