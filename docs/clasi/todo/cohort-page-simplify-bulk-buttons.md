---
status: pending
---

# Cohort page: simplify bulk action buttons

On the cohort detail page (e.g. `/cohorts/3`), the current bulk action
buttons don't match how cohorts actually work. Rework them:

## Remove

- **Create League** — doesn't make sense. A student can't be in a
  cohort until they already have a League account (cohort membership
  implies a League OU placement). Drop it.
- **Suspend League** and **Delete League** as separate buttons — the
  per-account-type split is misleading. Collapse them.
- Any **Create Log** buttons (if still rendered) — drop.

## Keep / rename

- Replace "Suspend League" and "Delete League" with **Suspend All**
  and **Delete All** — operate across every account the cohort member
  has (League email + Claude seat + any future app-level accounts).
- Effectively the useful button is just **Suspend** — that's the
  common admin action. Delete can stay as the heavier sibling.

## Notes

- "Suspend All" should be a wrapper around the existing per-account
  lifecycle suspend; same for Delete All.
- The Claude bulk buttons that still make sense can stay — e.g.
  bulk-invite Claude seats for students who have a League account but
  no Claude seat.
