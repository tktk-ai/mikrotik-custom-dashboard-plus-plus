import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
// CSS import is handled by Vite at runtime.
import '../src/index.css';
import { AppProvider } from '../src/lib/store';
import App from '../src/App';

/**
 * Mounts the real application (shell, routes, lazy pages, Toaster) at an
 * arbitrary route — used by scripts/smoke.tsx.
 */
export async function mount(container: Element, route: string): Promise<() => void> {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 1000 } } });
  const root = createRoot(container);
  root.render(
    <QueryClientProvider client={client}>
      <AppProvider>
        <MemoryRouter initialEntries={[route]}>
          <App />
        </MemoryRouter>
      </AppProvider>
    </QueryClientProvider>,
  );
  return () => {
    try {
      root.unmount();
    } catch {
      /* already unmounted */
    }
    client.clear();
  };
}
