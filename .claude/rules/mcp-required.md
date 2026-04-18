---
paths:
  - "**"
---

This project uses the CLASI MCP server. Before doing ANY work:

1. Call `get_version()` to verify the MCP server is running.
2. If the call fails, STOP. Do not proceed. Tell the stakeholder:
   "The CLASI MCP server is not available. Check .mcp.json and
   restart the session."
3. Do NOT create sprint directories, tickets, TODOs, or planning
   artifacts manually. Do NOT improvise workarounds. All SE process
   operations require the MCP server.
