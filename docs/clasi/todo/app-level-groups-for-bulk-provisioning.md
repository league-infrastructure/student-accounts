---
status: pending
---

# App-level groups for bulk provisioning

Add an app-native "group" concept that is **independent of Google
Workspace organization**. Groups live entirely inside this application.
A user can belong to **multiple** groups (unlike cohort, which is 1:1
and anchored to a Google OU).

We *may* optionally sync a group to a Google Group in the future, but
that's not in scope initially.

## Model

- New `Group` entity: id, name, optional description, timestamps.
- Many-to-many `User ↔ Group` join table.
- No required linkage to `Cohort` or to any Google OU.

## Pages

**Groups list page** (`/groups`)
- Lists all groups with member counts.
- Create group (name, optional description).
- Click a group to open its detail page.

**Group detail page** (`/groups/:id`)
- Shows current members.
- Search box — match users by display name, primary_email, or any
  login provider_email / provider_username.
- Clicking a search result adds that user to the group.
- Each member row has a Remove action.
- Bulk provisioning actions scoped to this group (see below).

**User detail page**
- New "Groups" section listing the user's groups.
- Add-to-group picker and per-row Remove.

## Bulk provisioning

Groups are the unit for fleet operations. Users can be added to a
group *before* any account provisioning — membership does not require
a League email, Claude seat, Pike13 link, or anything else.

From the group page, admins can:

- Bulk-create League email accounts for every eligible member.
- Bulk-invite Claude seats for every eligible member.
- Bulk-suspend / bulk-remove the same.
- Toggle LLM-proxy token access (see below) on or off for the whole
  group.
- (Future) Bulk-link Pike13 and other new account types as they land.

Each bulk action should follow the same succeeded/failed-with-reasons
pattern we use for cohort-scoped bulk actions today.

## LLM proxy token access

We plan to add a language-model proxy. Access to it is granted per-user
by a token we mint. Group membership is the natural switch: toggle the
group on, every member gets a token; toggle off, tokens revoked.

## Notes / questions to resolve during planning

- Naming: "Group" works, but consider disambiguating from Google
  Groups (`AppGroup`? `Cohort` vs `Group` vs something else?).
- Do groups ever need a Google OU? Probably not by default, but a
  later sprint can add opt-in Google Group sync.
- Overlap with cohort — cohort stays for OU-anchored student groupings;
  groups layer on top for arbitrary sets.
