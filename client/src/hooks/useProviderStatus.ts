import { useEffect, useState } from 'react';

export interface ProviderStatus {
  github: boolean;
  google: boolean;
  pike13: boolean;
  loading: boolean;
}

export function useProviderStatus(): ProviderStatus {
  const [status, setStatus] = useState<ProviderStatus>({
    github: false,
    google: false,
    pike13: false,
    loading: true,
  });

  useEffect(() => {
    fetch('/api/integrations/status')
      .then((r) => r.json())
      .then((data: Record<string, { configured?: boolean }>) => {
        setStatus({
          github: !!data.github?.configured,
          google: !!data.google?.configured,
          pike13: !!data.pike13?.configured,
          loading: false,
        });
      })
      .catch(() => setStatus((s) => ({ ...s, loading: false })));
  }, []);

  return status;
}
