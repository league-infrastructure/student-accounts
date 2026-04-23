/**
 * Tiny in-process event bus for broadcasting admin-visible state changes.
 *
 * Mutation handlers call `adminBus.notify('pending-users' | 'pending-requests')`
 * after they commit. The SSE endpoint at /api/admin/events subscribes and
 * forwards the topic name to connected admin clients, which then invalidate
 * the relevant TanStack Query caches.
 *
 * This is deliberately single-process. In a multi-instance deployment the
 * bus would need to move to Postgres LISTEN/NOTIFY or a message broker.
 */

import { EventEmitter } from 'node:events';

export type AdminChangeTopic = 'pending-users' | 'pending-requests';

class AdminChangeBus extends EventEmitter {
  notify(topic: AdminChangeTopic): void {
    this.emit('change', topic);
  }
}

export const adminBus = new AdminChangeBus();

// Generous ceiling — every open /api/admin/events tab registers one
// listener, plus tests may add transient subscribers.
adminBus.setMaxListeners(100);
