import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Subscribe to the admin SSE stream and invalidate React Query caches when
 * state changes anywhere in the system. Mount once in AdminLayout so every
 * admin page gets live updates without each one wiring its own listener.
 *
 * Topics map to query-key prefixes (TanStack Query invalidateQueries uses
 * fuzzy prefix matching by default, so `['admin', 'users']` cascades to
 * `['admin', 'users', 123]`, `['admin', 'users', 123, 'llm-proxy']`, etc.):
 *
 *   pending-users      → ['admin', 'dashboard', 'pending-users'],
 *                        ['admin', 'dashboard', 'stats']
 *   users              → ['admin', 'users']           (+ any sub-keys)
 *   cohorts            → ['admin', 'cohorts']         (+ any sub-keys)
 *   groups             → ['admin', 'groups']          (+ any sub-keys)
 *
 * No-op in environments without EventSource (jsdom, SSR).
 */
export function useAdminEventStream() {
  const queryClient = useQueryClient();

  useEffect(() => {
    if (typeof EventSource === 'undefined') return;

    const source = new EventSource('/api/admin/events');

    const invalidate = (keys: readonly (readonly unknown[])[]) => () => {
      for (const queryKey of keys) {
        queryClient.invalidateQueries({ queryKey: [...queryKey] });
      }
    };

    source.addEventListener(
      'pending-users',
      invalidate([
        ['admin', 'dashboard', 'pending-users'],
        ['admin', 'dashboard', 'stats'],
      ]),
    );
    source.addEventListener('users', invalidate([['admin', 'users']]));
    source.addEventListener('cohorts', invalidate([['admin', 'cohorts']]));
    source.addEventListener('groups', invalidate([['admin', 'groups']]));

    return () => {
      source.close();
    };
  }, [queryClient]);
}
