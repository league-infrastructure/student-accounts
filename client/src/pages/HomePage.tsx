import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';

interface Counter {
  name: string;
  value: number;
}

async function fetchCounters(): Promise<Counter[]> {
  const res = await fetch('/api/counters');
  if (!res.ok) throw new Error(`Failed to load counters (${res.status})`);
  return res.json();
}

async function incrementCounter(name: string): Promise<Counter> {
  const res = await fetch(`/api/counters/${encodeURIComponent(name)}/increment`, {
    method: 'POST',
  });
  if (!res.ok) throw new Error(`Failed to increment counter (${res.status})`);
  return res.json();
}

export default function HomePage() {
  const queryClient = useQueryClient();

  const { data: counters, isLoading, isError, error } = useQuery<Counter[]>({
    queryKey: ['counters'],
    queryFn: fetchCounters,
  });

  const increment = useMutation({
    mutationFn: incrementCounter,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['counters'] });
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-slate-500">Loading counters…</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex items-center justify-center py-16">
        <p className="text-red-500">
          {error instanceof Error ? error.message : 'Failed to load counters'}
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto py-10 px-4">
      <h1 className="text-2xl font-semibold text-slate-800 mb-6">Counters</h1>

      <div className="flex flex-col gap-4">
        {(counters ?? []).map((counter) => (
          <div
            key={counter.name}
            className="flex items-center justify-between bg-white border border-slate-200 rounded-xl px-6 py-4 shadow-sm"
          >
            <div>
              <p className="text-sm font-medium text-slate-500 uppercase tracking-wide">
                {counter.name}
              </p>
              <p className="text-3xl font-bold text-indigo-600 mt-0.5">{counter.value}</p>
            </div>

            <button
              onClick={() => increment.mutate(counter.name)}
              disabled={increment.isPending}
              className="bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white font-semibold rounded-lg px-4 py-2 text-sm transition-colors"
              aria-label={`Bump ${counter.name}`}
            >
              Bump {counter.name}
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
