import React, { Suspense, lazy } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { Shell } from './components/Shell';
import { Spinner, Toaster } from './components/ui';
import Dashboard from './pages/Dashboard';

// The overview is the landing page, so it stays in the main chunk; every other
// module is fetched on demand (the catalog-driven pages pull in the whole
// endpoint catalogue, which is worth splitting out).
const EndpointPage = lazy(() => import('./pages/Endpoint'));
const TopologyPage = lazy(() => import('./pages/Topology'));
const DevicesPage = lazy(() => import('./pages/Devices'));
const InsightsPage = lazy(() => import('./pages/Insights'));
const TrafficPage = lazy(() => import('./pages/Traffic'));
const Explorer = lazy(() => import('./pages/Explorer'));
const Connections = lazy(() => import('./pages/Connections'));
const Console = lazy(() => import('./pages/Console'));
const Settings = lazy(() => import('./pages/Settings'));

const ScrollToTop: React.FC = () => {
  const { pathname } = useLocation();
  React.useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return null;
};

const PageLoading: React.FC = () => (
  <div className="grid min-h-[60vh] place-items-center">
    <div className="flex items-center gap-2.5 text-dim">
      <Spinner className="size-5" />
      <span className="text-[13px]">Loading module…</span>
    </div>
  </div>
);

const App: React.FC = () => (
  <>
    <ScrollToTop />
    <Shell>
      <Suspense fallback={<PageLoading />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/m/*" element={<EndpointPage />} />
          <Route path="/topology" element={<TopologyPage />} />
          <Route path="/devices" element={<DevicesPage />} />
          <Route path="/insights" element={<InsightsPage />} />
          <Route path="/traffic" element={<TrafficPage />} />
          <Route path="/explorer" element={<Explorer />} />
          <Route path="/connections" element={<Connections />} />
          <Route path="/console" element={<Console />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/dashboard" element={<Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </Shell>
    <Toaster />
  </>
);

export default App;
