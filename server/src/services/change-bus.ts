/**
 * Tiny in-process event bus for broadcasting admin-visible state changes.
 *
 * Mutation handlers call `adminBus.notify(topic)` after they commit. The
 * SSE endpoint at /api/admin/events subscribes and forwards the topic
 * name to connected admin clients, which then invalidate the relevant
 * TanStack Query caches. Topic list is defined by `AdminChangeTopic`.
 *
 * This is deliberately single-process. In a multi-instance deployment the
 * bus would need to move to Postgres LISTEN/NOTIFY or a message broker.
 */

import { EventEmitter } from 'node:events';

/**
 * Admin SSE topics. Kept coarse on purpose — clients use React Query's
 * default prefix-match invalidation, so `users` cascades to every key
 * starting with `['admin', 'users', ...]`.
 *
 *   pending-users      — /admin/pending-users list or user.approval_status changed
 *   users              — any user row mutated (role, cohort, approval,
 *                        deletion, external accounts, LLM proxy token)
 *   cohorts            — cohort list or cohort membership changed
 *   groups             — group list or group membership changed
 */
export type AdminChangeTopic =
  | 'pending-users'
  | 'users'
  | 'cohorts'
  | 'groups';

class AdminChangeBus extends EventEmitter {
  notify(topic: AdminChangeTopic): void {
    this.emit('change', topic);
  }
}

export const adminBus = new AdminChangeBus();

// Generous ceiling — every open /api/admin/events tab registers one
// listener, plus tests may add transient subscribers.
adminBus.setMaxListeners(100);

// ---------------------------------------------------------------------------
// User-scoped change bus for per-user account updates (Sprint 015).
//
// When an admin approves/rejects a provisioning request, grants/revokes an
// LLM proxy token, or approves/denies a pending account, fire
// `userBus.notifyUser(userId)`. The SSE endpoint at /api/account/events
// subscribes to user-specific events and forwards them to the student,
// triggering a re-fetch of their account data.
// ---------------------------------------------------------------------------

class UserChangeBus extends EventEmitter {
  notifyUser(userId: number): void {
    this.emit(`user-${userId}`);
  }
}

export const userBus = new UserChangeBus();

// Generous ceiling — accommodates many simultaneous student sessions
// across multiple browser tabs.
userBus.setMaxListeners(500);
