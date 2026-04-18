---
id: '012'
title: 'Foundation: Error Hierarchy, Versioning & Deploy Script'
status: done
branch: sprint/012-foundation-error-hierarchy-versioning-deploy-script
use-cases:
- SUC-001
- SUC-002
- SUC-003
---

# Sprint 012: Foundation: Error Hierarchy, Versioning & Deploy Script

## Goals

Add three foundational infrastructure improvements: typed error classes
with automatic HTTP status mapping, date-based version management with
git tags, and a deploy script with pre-flight validation.

## Problem

1. Error handling is inconsistent — services throw raw errors, routes
   use ad-hoc try/catch with hardcoded status codes, and the error
   handler middleware is a bare 500 catch-all.
2. There is no version management — no tagging, no version in the health
   endpoint, no way to know what's deployed.
3. Deployment is manual — no script validates preconditions before
   building and pushing to production.

## Solution

1. Create a `ServiceError` class hierarchy (`server/src/errors.ts`) with
   subclasses for 400/401/403/404/409. Update the error handler middleware
   to detect `ServiceError` instances and return the correct status code.
   Migrate existing services to throw typed errors.
2. Add `scripts/version.sh` for date-based versioning (`0.YYYYMMDD.N`),
   npm scripts for bumping/tagging, and expose the version in the health
   endpoint.
3. Add `scripts/deploy.sh` with pre-flight checks (clean tree, correct
   branch, version tag, Docker, required env vars) and the full
   build → push → deploy → migrate pipeline.

## Success Criteria

- ServiceError subclasses map to correct HTTP status codes
- Existing services throw typed errors instead of raw errors
- Error handler middleware returns structured JSON for all error types
- `scripts/version.sh` outputs correct `0.YYYYMMDD.N` versions
- Health endpoint includes the app version
- `scripts/deploy.sh` rejects dirty trees, wrong branches, missing tags
- All existing tests continue to pass
- New tests cover error hierarchy and version script

## Scope

### In Scope

- ServiceError class hierarchy and error handler middleware update
- Migrating existing services (UserService, etc.) to typed errors
- Version script, npm scripts, health endpoint version exposure
- Deploy script with pre-flight checks and Swarm deployment
- Tests for error handling and version script

### Out of Scope

- Client-side error display changes
- CI/CD pipeline integration
- Automated deployments (deploy script is manual)

## Test Strategy

- Server tests for error handler middleware (each error type → correct status)
- Server tests verifying services throw typed errors for known conditions
- Shell script test for version.sh (correct output format)
- Deploy script validation tested via pre-flight check failures

## Architecture Notes

- Error classes are pure TypeScript, no runtime dependencies
- Version script is a standalone bash script, no Node dependencies
- Deploy script uses existing Docker and Swarm infrastructure
- Health endpoint change is additive (new field, no breaking changes)

## Definition of Ready

Before tickets can be created, all of the following must be true:

- [x] Sprint planning documents are complete (sprint.md, use cases, architecture)
- [x] Architecture review passed
- [x] Stakeholder has approved the sprint plan

## Tickets

1. #001 — Create ServiceError class hierarchy and update error handler middleware
2. #002 — Migrate existing services to throw typed ServiceErrors
3. #003 — Add date-based version script and expose version in health endpoint
4. #004 — Create deploy script with pre-flight checks
5. #005 — Write tests for error hierarchy, version script, and deploy pre-flights
