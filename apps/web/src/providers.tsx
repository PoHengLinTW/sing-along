import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import { ApiRequestError } from './api/client';
import { ToastProvider, useToast } from './ui/toast';

declare module '@tanstack/react-query' {
  interface Register {
    queryMeta: { handles404?: boolean; silent?: boolean };
  }
}

function QueryBridge({ children }: { children: ReactNode }) {
  const toast = useToast();
  const [client] = useState(() => {
    const report = (err: unknown) =>
      toast.error(err instanceof ApiRequestError ? err.message : 'Something went wrong.');
    return new QueryClient({
      defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
      queryCache: new QueryCache({
        onError: (err, query) => {
          if (query.meta?.silent) return; // informational queries (storage meter) fail quietly
          // Pages that render their own "not found" state opt out of the toast.
          if (err instanceof ApiRequestError && err.status === 404 && query.meta?.handles404)
            return;
          report(err);
        },
      }),
      mutationCache: new MutationCache({ onError: (err) => report(err) }),
    });
  });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <QueryBridge>{children}</QueryBridge>
    </ToastProvider>
  );
}
