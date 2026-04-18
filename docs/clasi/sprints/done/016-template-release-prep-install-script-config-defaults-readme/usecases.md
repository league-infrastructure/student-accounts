---
status: final
---

# Sprint 016 Use Cases

## SUC-001: Student Clones and Runs Install

- **Actor**: Student
- **Preconditions**: Node.js installed, template cloned
- **Main Flow**:
  1. Student runs `scripts/install.sh`
  2. Script installs npm dependencies (root, server, client)
  3. Script detects CLASI history from template development and clears it
  4. Script runs `clasi init` to create fresh project
  5. Script generates .env with SQLite defaults
- **Postconditions**: Clean project ready for `npm run dev`
- **Acceptance Criteria**:
  - [ ] CLASI sprints/done, todo/done, reflections, architecture/done are cleared
  - [ ] Fresh .clasi.db created
  - [ ] .env defaults to SQLite DATABASE_URL

## SUC-002: Student Starts Dev Server

- **Actor**: Student
- **Preconditions**: Install script has been run
- **Main Flow**:
  1. Student runs `npm run dev`
  2. App detects SQLite DATABASE_URL, starts without Docker
  3. Student sees app at localhost
- **Postconditions**: App running with SQLite, zero Docker dependency
- **Acceptance Criteria**:
  - [ ] `npm run dev` works immediately after install script
  - [ ] No Docker required for default configuration
