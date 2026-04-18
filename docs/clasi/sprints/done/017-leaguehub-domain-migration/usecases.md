---
status: approved
---

# Sprint 017 Use Cases

## SUC-001: Instructor Views Dashboard
Parent: n/a

- **Actor**: Instructor
- **Preconditions**: Logged in via Pike13 OAuth, has active instructor record
- **Main Flow**:
  1. Instructor navigates to /dashboard
  2. System shows review status counts for selected month (pending, draft, sent)
  3. Instructor can change month via MonthPicker
- **Postconditions**: Dashboard displays current month's review statistics
- **Acceptance Criteria**:
  - [ ] Dashboard loads with review counts
  - [ ] MonthPicker changes displayed data

## SUC-002: Instructor Creates/Edits/Sends Monthly Review
Parent: n/a

- **Actor**: Instructor
- **Preconditions**: Logged in, has assigned students
- **Main Flow**:
  1. Instructor navigates to /reviews, selects a month
  2. System lists students with review status
  3. Instructor clicks a student to open ReviewEditor
  4. Instructor writes/edits review, optionally applies a template
  5. Instructor sends review (email to guardian)
- **Postconditions**: Review saved; if sent, email delivered and status = SENT
- **Acceptance Criteria**:
  - [ ] Review CRUD works (create, read, update)
  - [ ] Send triggers email via SendGrid (no-op without API key)
  - [ ] Review status transitions: PENDING → DRAFT → SENT

## SUC-003: Guardian Submits Feedback
Parent: n/a

- **Actor**: Guardian (public, no login)
- **Preconditions**: Has received email with feedback token URL
- **Main Flow**:
  1. Guardian clicks /feedback/:token link
  2. System shows the review and a feedback form
  3. Guardian submits rating + optional comment
- **Postconditions**: Feedback recorded in ServiceFeedback table
- **Acceptance Criteria**:
  - [ ] Public page loads without auth
  - [ ] Feedback submission persists

## SUC-004: Admin Views Compliance Report
Parent: n/a

- **Actor**: Admin
- **Preconditions**: Logged in as admin
- **Main Flow**:
  1. Admin navigates to /admin/compliance
  2. System shows per-instructor review completion for selected month
- **Postconditions**: Compliance data displayed
- **Acceptance Criteria**:
  - [ ] Compliance report loads with instructor-level data

## SUC-005: Admin Manages Volunteer Hours
Parent: n/a

- **Actor**: Admin
- **Preconditions**: Logged in as admin
- **Main Flow**:
  1. Admin navigates to /admin/volunteer-hours
  2. System shows volunteer hours list with summary
  3. Admin can add/edit/delete entries
- **Postconditions**: Volunteer hours updated
- **Acceptance Criteria**:
  - [ ] CRUD operations work
  - [ ] Summary totals display correctly
