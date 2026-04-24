import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';

/**
 * Open an SSE connection to /api/account/events and invalidate the
 * 'account' query whenever the student's account data changes (approval
 * status, provisioning requests approved, LLM proxy token granted/revoked,
 * etc.).
 *
 * This hook is a no-op in SSR/jsdom environments where EventSource is
 * unavailable.
 */
export function useAccountEventStream() {
  const queryClient = useQueryClient();

  useEffect(() => {
    // Skip in environments without EventSource (jsdom, SSR, etc.)
    if (typeof EventSource === 'undefined') return;

    const source = new EventSource('/api/account/events');

    source.addEventListener('account-updated', () => {
      queryClient.invalidateQueries({ queryKey: ['account'] });
      queryClient.invalidateQueries({ queryKey: ['account', 'llm-proxy'] });
    });

    return () => {
      source.close();
    };
  }, [queryClient]);
}
