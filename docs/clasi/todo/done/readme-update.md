---
title: 'Update README: Focus on Getting Started'
type: todo
priority: high
status: done
sprint: '016'
tickets:
- '004'
---

# Update README: Focus on Getting Started

## Problem

The README still refers to "secrets" instead of "config" and includes a repository layout section that may not add value. It needs to be rewritten to lead with the student experience: clone, run install, start building.

## What Needs to Happen

1. **Lead with Getting Started** — the very first thing a student reads should be:
   - Clone the repo
   - Run `scripts/install.sh`
   - Run `npm run dev`

2. **Remove outdated references** — "secrets" terminology should be "config" where applicable

3. **Evaluate repository layout section** — remove it if it doesn't help students. The code is self-documenting and the install script handles setup.

4. **Keep it short** — students won't read a wall of text. Minimal, actionable, top-down.
