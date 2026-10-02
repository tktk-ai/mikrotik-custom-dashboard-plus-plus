import React, { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, type Capabilities, type ConnectionInfo } from './api';

type Theme = 'dark' | 'light';

interface AppState {
  connections: ConnectionInfo[];
  activeId: string | null;
  connection: ConnectionInfo | null;
  capabilities: Capabilities | undefined;
  mode: 'demo' | 'live';
  refreshMs: number | null;
  setRefreshMs: (ms: number | null) => void;
  theme: Theme;
  toggleTheme: () => void;
  refreshCapabilities: () => Promise<void>;
  refreshing: boolean;
  switchConnection: (id: string) => Promise<void>;
  supported: (path: string) => 'yes' | 'no' | 'unknown';
  favorites: string[];
  toggleFavorite: (path: string) => void;
  density: 'comfortable' | 'compact';
  setDensity: (d: 'comfortable' | 'compact') => void;
}

const Ctx = createContext<AppState | null>(null);

export const REFRESH_OPTIONS: Array<{ value: number | null; label: string }> = [
  { value: null, label: 'Off' },
  { value: 2000, label: '2s' },
  { value: 5000, label: '5s' },
  { value: 10000, label: '10s' },
  { value: 30000, label: '30s' },
];

const read = <T,>(key: string, fallback: T): T => {
  try {
    const raw = localStorage.getItem(key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch { return fallback; }
};

export const AppProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const qc = useQueryClient();
  const [refreshMs, setRefreshMsState] = useState<number | null>(() => read<number | null>('rcd.refreshMs', 5000));
  const [theme, setTheme] = useState<Theme>(() => read<Theme>('rcd.theme', 'dark'));
  const [density, setDensityState] = useState<'comfortable' | 'compact'>(() => read('rcd.density', 'comfortable'));
  const [favorites, setFavorites] = useState<string[]>(() => read<string[]>('rcd.favorites', []));

  useEffect(() => {
    document.documentElement.classList.toggle('light', theme === 'light');
    localStorage.setItem('rcd.theme', JSON.stringify(theme));
  }, [theme]);
  useEffect(() => { localStorage.setItem('rcd.refreshMs', JSON.stringify(refreshMs)); }, [refreshMs]);
  useEffect(() => { localStorage.setItem('rcd.density', JSON.stringify(density)); }, [density]);
  useEffect(() => { localStorage.setItem('rcd.favorites', JSON.stringify(favorites)); }, [favorites]);

  const connQuery = useQuery({
    queryKey: ['connections'],
    queryFn: () => api.listConnections(),
    staleTime: 10_000,
  });

  const capsQuery = useQuery({
    queryKey: ['capabilities', connQuery.data?.activeId],
    queryFn: () => api.capabilities(),
    enabled: Boolean(connQuery.data),
    staleTime: 60_000,
    retry: false,
  });

  const refreshMutation = useMutation({
    mutationFn: () => api.refreshCapabilities(),
    onSuccess: (data) => qc.setQueryData(['capabilities', data.connectionId], data),
  });

  const switchMutation = useMutation({
    mutationFn: (id: string) => api.activateConnection(id),
    onSuccess: async () => {
      await qc.invalidateQueries();
    },
  });

  const connections = connQuery.data?.connections ?? [];
  const activeId = connQuery.data?.activeId ?? null;
  const connection = useMemo(() => connections.find((c) => c.id === activeId) ?? null, [connections, activeId]);

  const value: AppState = {
    connections,
    activeId,
    connection,
    capabilities: capsQuery.data,
    mode: connection?.demo ? 'demo' : 'live',
    refreshMs,
    setRefreshMs: setRefreshMsState,
    theme,
    toggleTheme: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
    refreshCapabilities: async () => { await refreshMutation.mutateAsync(); },
    refreshing: refreshMutation.isPending || capsQuery.isFetching,
    switchConnection: async (id: string) => { await switchMutation.mutateAsync(id); },
    supported: (path: string) => {
      const cap = capsQuery.data?.endpoints?.[path];
      if (!capsQuery.data) return 'unknown';
      if (!cap) return 'unknown';
      return cap.ok ? 'yes' : 'no';
    },
    favorites,
    toggleFavorite: (path: string) => setFavorites((f) => (f.includes(path) ? f.filter((x) => x !== path) : [...f, path])),
    density,
    setDensity: setDensityState,
  };

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useApp = (): AppState => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useApp must be used inside AppProvider');
  return ctx;
};
