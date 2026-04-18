---
title: User Account Management — Feature Specification
status: active
---

# User Account Management — Feature Specification

---

## 1. Overview

The League runs a programming school for students in grades 2–12. Running the
school requires provisioning and managing a set of third-party accounts per
student: Google Workspace (student email under the League's domain), Claude
Team (paid seats for Claude and Claude Code access), GitHub, and Pike13 (class
management, where parents also have visibility).

Today these systems are managed independently. This application consolidates
them. A single record represents a student, and that record links to whatever
external accounts exist for them. Administrators can provision, suspend, and
remove external accounts from one place, operate on whole cohorts at once, and
write selected data back to Pike13 so parents see it.

### 1.1 Goals

- Represent each student as one canonical user record, regardless of how they
  first entered the system.
- Let students sign in via social login (Google, GitHub) — no passwords stored
  by this app.
- Let administrators provision a League Google Workspace account and a Claude
  Team seat for any student, on demand.
- Let administrators suspend or remove those accounts individually or by
  cohort.
- Organize students into cohorts, which map to Google Workspace Organizational
  Units.
- Detect and merge duplicate user records using an LLM-assisted suggestion
  workflow.
- Write League email and GitHub handle back to Pike13 as custom fields, so
  parents see them.
- Maintain an audit log of all administrative actions.

### 1.2 Non-Goals

- This app does not store passwords or run its own password-based login.
- It does not manage Pike13 enrollments, billing, or class scheduling.
- It does not sync GitHub repository membership or organization invitations
  (the GitHub link is informational; managing it is the student's
  responsibility).
- It does not deprovision Pike13 accounts. Pike13 lifecycle is handled
  independently — students who stop attending simply remain in Pike13.
- It does not provision staff accounts of any kind. Staff already have
  `@jointheleague.org` Workspace accounts, created outside this system. This
  app is strictly a consumer of those accounts for sign-in purposes.
- It cannot create `@jointheleague.org` addresses. The only League Workspace
  accounts this app creates are student accounts on the
  `@students.jointheleague.org` domain, placed in a student cohort OU.
  Creating staff-domain addresses is outside its scope and is prevented at the
  integration layer.

---

## 2. Core Concepts

### 2.1 User

A User represents a person. Every student, staff member, and administrator is
a User. A User is created one of three ways:

1. **Social login** — a person signs in through Google or GitHub, and if no
   matching User exists, one is created.
2. **Pike13 sync** — an administrator imports a Pike13 person record, creating
   a User linked to that Pike13 ID.
3. **Administrator creation** — rare, but supported for edge cases (e.g.,
   staff who have no Pike13 record yet).

A User has a primary email. For students, the primary email is the external
Google account the student already controls (typically a personal or K–12
school address). This is the address the League Workspace welcome email is
sent to. The primary email is never a League-issued address, because the
League address is what gets created later.

### 2.2 Login

A Login is a credential attached to a User. A User can have multiple Logins.
Supported Login types:

- Google (social login)
- GitHub (social login)

Additional Logins are added in two ways: the User adds one themselves from
their account page, or an administrator adds one on their behalf. Logins can
be removed, provided the User has at least one Login remaining.

### 2.3 External Account

An External Account is a provisioned resource that belongs to the User but
lives in a third-party system. Unlike Logins, External Accounts are not
authentication methods for this app — they are services the User has been
given access to. Supported External Account types:

- League Google Workspace account (created by this app via the Google Admin
  SDK)
- Claude Team seat (created by this app via the Claude Team Admin API)
- Pike13 person record (linked, not created; Pike13 records originate in
  Pike13)

Each External Account has a lifecycle state: `pending`, `active`,
`suspended`, or `removed`. Suspension and removal are distinct: suspension is
reversible and preserves data; removal releases the seat or deletes the
account.

### 2.4 Cohort

A Cohort is a named group of students, typically one program-year combination
(e.g., "League Lab Summer 26", "Code Club Fall 25"). Cohorts serve two
purposes:

1. They map to Organizational Units in Google Workspace. When a League
   Workspace account is created for a student, it is placed in the OU
   corresponding to the student's cohort.
2. They are the unit for bulk operations. Administrators can suspend, remove,
   or otherwise act on all External Accounts belonging to a cohort at once —
   for example, suspending all Claude Team seats for a cohort at the end of a
   term.

A student belongs to exactly one cohort at a time (because OU membership in
Google is exclusive). Cohorts are created and managed in this application;
creating a cohort creates the corresponding OU in Google Workspace.

### 2.5 Roles

Three roles, with escalating permissions:

- **Student** — signs in to view their own account page, add or remove their
  own Logins, and request provisioning (e.g., request a League email or Claude
  Team seat).
- **Staff** — views all students across the organization, read-only. Cannot
  provision, suspend, or remove External Accounts; cannot merge Users or
  manage cohorts. No per-cohort restriction on what they can see.
- **Administrator** — full access. Provisions, suspends, removes, merges, and
  manages cohorts.

**Staff sign-in model.** Staff identity is inherited from Google Workspace,
not managed by this app. A person is treated as staff if and only if they sign
in with a Google account in the League staff OU (members of
`@jointheleague.org`, excluding the student domain). Staff Users have exactly
one Login — their League staff Google account — and no External Accounts. The
app does not let staff add GitHub Logins, link Pike13 records, or get
provisioned a Claude seat or student email. The app is purely a read tool for
them.

---

## 3. User Lifecycle

### 3.1 Account Creation

**Via social login.** A prospective student visits the app and chooses "Sign
in with Google" or "Sign in with GitHub." If no User matches the returned
identity, a new User is created with that Login attached. The email address
from the social provider becomes the primary email.

**Via Pike13 sync.** An administrator runs a Pike13 sync (on demand or
scheduled). For each Pike13 person who has no matching User, a new User is
created with the Pike13 ID attached as an External Account of type "Pike13
person record." The Pike13 email becomes the primary email. These Users have
no Login yet; they become reachable when they first sign in socially and the
merge workflow (§3.3) attaches a Login to the existing record.

### 3.2 Adding Logins and External Accounts

Once a User exists, an administrator viewing that User can:

- Add a Login on the User's behalf (rare; normally the User does this
  themselves).
- Provision a League Google Workspace account. The app creates the account via
  the Google Admin SDK in the OU corresponding to the User's cohort, generates
  a temporary password, and emails the credentials to the User's primary email.
- Provision a Claude Team seat. The seat invitation is sent only to the
  student's League Workspace address. A Claude Team seat cannot be provisioned
  until the League Workspace account exists (see §8, decision 1).
- Link a Pike13 person record, if one was not found during sync.

A student viewing their own account page can request provisioning; the request
goes to an administrator to approve and execute.

### 3.3 Merging Duplicate Users

Duplicates happen. A student signs in with GitHub and creates User A; later
the administrator syncs Pike13 and creates User B for the same person. The
app must detect and resolve these duplicates.

The approach:

1. On every new User creation, the app runs a similarity check against
   existing Users.
2. A Claude Haiku model evaluates each candidate pair and produces a
   confidence score plus a short rationale ("same first and last name, emails
   differ only in domain, likely the same person").
3. Pairs scoring >= 0.6 appear in an administrator merge queue. Pairs scoring
   < 0.6 are discarded without being shown. A single threshold is used; there
   is no intermediate "medium-confidence" tier (see §8, decision 7).
4. The administrator reviews each pair side by side and approves, rejects, or
   defers.
5. On approval, the two User records are merged: Logins, External Accounts,
   and cohort assignment are consolidated onto the surviving record; the audit
   log records the merge.

Auto-merge without administrator review is not supported. Merges involve real
accounts with real data; human confirmation is required.

### 3.4 Suspension

Suspending a User is an administrative action that cascades to the User's
External Accounts. For each External Account type, the administrator chooses
(at suspension time, with a per-cohort default) whether to:

- **Suspend the seat or account** — reversible, preserves data. (Google
  Workspace account suspended, Claude Team seat suspended.)
- **Remove from workspace** — releases the seat or deletes the account.
  Google Workspace: follow the standard suspend-then-delete process (suspended
  immediately, deleted 3 days later). Claude Team: seat removed from
  workspace.

Both actions are available at the individual User level and at the cohort
level. A typical end-of-term flow: administrator opens a cohort, selects
"Suspend all Claude Team seats," confirms, and every Claude seat in the cohort
is suspended in a single batch with one audit log entry per seat.

### 3.5 Deprovisioning

When a student leaves the school:

- **League Google Workspace account:** suspended, then deleted after the
  retention period. Standard Workspace lifecycle.
- **Claude Team seat:** removed from workspace.
- **Pike13 record:** untouched. Pike13 is managed independently; students who
  stop attending remain in Pike13 until Pike13 itself is cleaned up.
- **GitHub Login:** untouched. The student owns their GitHub account; it
  remains linked unless the student (or an administrator acting on the
  student's request) removes it.

---

## 4. Student-Facing View

A student who signs in sees a single page showing the state of their account.
The page has four sections:

- **Profile** — name, primary email, cohort.
- **Logins** — list of connected sign-in methods (Google, GitHub). Buttons to
  add a missing one or remove an existing one. At least one Login must remain.
- **Services** — list of provisioned External Accounts with their status
  (League email address, Claude Team seat, Pike13 link). Buttons to request
  any that are missing, subject to the rules below.
- **Help / contact** — link to request administrator assistance.

**Self-service provisioning rules.** A student can request:

- A League email, on its own.
- A League email and a Claude Team seat together.

A student cannot request a Claude Team seat without a League email — the seat
binds to the League address, so the League account has to exist first. The app
enforces this by making the Claude seat request option unavailable until the
League email has been requested (or already exists).

Everything on this page is scoped to the signed-in User. Students cannot see
other students.

---

## 5. Administrator-Facing Views

### 5.1 User Directory

A searchable list of all Users. Filters by cohort, by role, by External
Account status (has League email, has Claude seat, has Pike13 link, etc.).
Selecting a User opens that User's detail view.

### 5.2 User Detail View

Shows everything about one User: profile, Logins, External Accounts, cohort,
audit history. Action buttons to provision, suspend, or remove each External
Account type. Merge-with-another-user action.

### 5.3 Cohort Management

List of cohorts. Create new cohort (creates the corresponding Google OU). For
each cohort: list of students, bulk actions (suspend all Claude seats, suspend
all League accounts, remove all from workspace, etc.).

### 5.4 Merge Queue

List of candidate duplicate pairs flagged by the Haiku scan. Side-by-side
comparison, approve / reject / defer actions.

### 5.5 Audit Log

Chronological log of administrative actions. Searchable by User,
administrator, action type, and date range. Every provisioning, suspension,
removal, merge, Login add/remove, and cohort change is recorded.

### 5.6 Staff View

Staff see the full user directory org-wide, read-only. No per-cohort
restriction — staff see all students across the organization. Read-only on
profile and External Account status. No provisioning, suspension, removal,
merge, or cohort-management actions are available.

---

## 6. Integrations

### 6.1 Google Workspace

Via the Google Admin SDK, using a service account with domain-wide delegation.
Operations required:

- **Create user** — restricted to the `@students.jointheleague.org` domain,
  placed in a student cohort OU. The app must refuse, at the integration
  layer, to create accounts on `@jointheleague.org` or outside a student OU.
  Welcome email (including the temporary password) is delivered by Google
  itself via the Admin SDK's `sendNotificationEmail` option, sent to the
  User's primary email.
- **Suspend user.**
- **Delete user** (3-day retention after suspension; see §3.4).
- **Create OU** for a new cohort, as a child of the student OU root.
- **List users in an OU** (for cohort bulk operations).
- **Read staff OU membership** — used at sign-in to identify staff Users
  (see §2.5).

### 6.2 Claude Team

Via the Claude Team admin API. Operations required:

- **Invite or add a seat.** The seat invitation is sent only to the student's
  League Workspace address (`@students.jointheleague.org`). The student's
  external primary email is not involved in the Claude seat invitation. A
  Claude Team seat cannot be provisioned until the League Workspace account
  exists; granting Claude access is in fact one of the primary reasons the
  student Workspace account exists.
- **Suspend a seat.**
- **Remove a seat** from the workspace.
- **List seats** (for cohort bulk operations and reconciliation).

### 6.3 GitHub

GitHub is social-login only. This app does not create, modify, or manage
GitHub accounts or organization membership. It only records that a GitHub
Login is attached to a User and what the GitHub username is.

### 6.4 Pike13

Via the Pike13 API. Operations required:

- **List and search people** (for sync and for linking unmatched Users).
- **Read person details** (for merge suggestions and display).
- **Update custom fields** on a person record. Two custom fields must be
  created in Pike13: **"GitHub Username"** and **"League Email Address."**
  When a Login or External Account of the corresponding type is added, the app
  writes the value back to the Pike13 record so parents can see it.

### 6.5 Claude Haiku (Merge Suggestions)

Via the Anthropic API. The merge scanner constructs a prompt containing two
candidate User records (names, emails, Pike13 ID if present, cohort, creation
date) and asks Haiku to judge whether they represent the same person. Haiku
returns a confidence score and a short rationale. Only high-confidence
suggestions are surfaced; low-confidence pairs are discarded.

Confidence thresholds (tunable defaults per §8, decision 7):

- Pairs scoring **>= 0.6** surface in the merge queue for administrator
  review.
- Pairs scoring **< 0.6** are discarded without being shown.

A single threshold is used — not a three-tier surface/review/discard split —
to keep the queue from becoming a dumping ground of weak matches.

---

## 7. Data Model (Sketch)

Rough entity shape, to be firmed up in the build specification:

| Entity | Fields (sketch) |
|---|---|
| **User** | id, display_name, primary_email, role (student/staff/admin), cohort_id, created_at, created_via |
| **Login** | id, user_id, provider (google/github), provider_user_id, provider_email, created_at |
| **ExternalAccount** | id, user_id, type (workspace/claude/pike13), external_id, status (pending/active/suspended/removed), created_at, status_changed_at |
| **Cohort** | id, name, google_ou_path, created_at |
| **MergeSuggestion** | id, user_a_id, user_b_id, haiku_confidence, haiku_rationale, status (pending/approved/rejected/deferred), decided_by, decided_at |
| **AuditEvent** | id, actor_user_id, action, target_user_id, target_entity_type, target_entity_id, details (json), created_at |
| **ProvisioningRequest** | id, user_id, requested_type, status (pending/approved/rejected), decided_by, decided_at |

---

## 8. Resolved Decisions

All decisions below represent the authoritative, final resolution. They
supersede any conflicting text in earlier draft documents.

1. **Claude seat email binding** — The seat invitation is sent only to the
   student's League Workspace address (`@students.jointheleague.org`). The
   student's external primary email is not part of the Claude seat invitation.
   A Claude Team seat cannot be provisioned until the League Workspace account
   exists. (Supersedes older draft language suggesting invitations be sent to
   both addresses.)

2. **Merge scanner cadence** — The similarity check runs on every new User
   creation, not as a background batch job.

3. **Staff scoping** — Staff identity comes from membership in the League
   staff OU (`@jointheleague.org`). The app reads OU membership at sign-in
   and assigns the staff role automatically. Staff have no other scoping
   dimension — they see students across the organization, read-only. There is
   no per-cohort restriction on staff visibility. (Supersedes older draft
   language suggesting staff see only cohorts they teach.)

4. **Workspace account retention** — Suspended Workspace accounts are deleted
   3 days after suspension.

5. **Password delivery** — Handled entirely by Google. The Admin SDK sends the
   welcome email with temporary password to the User's primary email on
   account creation. This app does not compose or send password emails itself.

6. **Self-service provisioning** — Students can request (a) a League email
   alone, or (b) a League email and a Claude seat together. A Claude seat
   alone is not a valid request because the seat depends on the League address.

7. **Haiku confidence thresholds** — Tunable defaults: pairs scoring >= 0.6
   surface in the merge queue for administrator review; pairs below 0.6 are
   discarded without being shown. A single threshold is used, not a three-tier
   surface/review/discard split, to keep the queue from becoming a dumping
   ground of weak matches. (Supersedes older draft language describing a
   medium-confidence "review if interested" section.)

---

## 9. Remaining Open Questions

None. All questions raised during initial requirements review have been
resolved (see §8).
