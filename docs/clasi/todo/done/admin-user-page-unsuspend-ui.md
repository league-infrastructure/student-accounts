---
status: done
sprint: '011'
tickets:
- '001'
- '003'
---

# Admin user page: show suspension state and an Unsuspend button

On the admin's user detail page (`/users/:id`), when an ExternalAccount
(workspace or claude) is in `suspended` status:

- Show the status clearly next to the account card — it currently only
  hides the Suspend button, which makes it look like nothing happened.
- Add an **Unsuspend** button that drives the same reactivation flow
  used by the student's "Request re-activation" path
  (workspace-provisioning.unsuspendUser + ExternalAccount.status ->
  active; analogous flow for claude if/when we support that).

Seen at <http://localhost:5173/users/2> after suspending a student's
Claude account — no "suspended" label and no way to reverse it.
