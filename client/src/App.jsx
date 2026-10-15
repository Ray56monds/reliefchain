import { lazy, Suspense, useEffect } from 'react';
import { Routes, Route, Link, useLocation } from 'react-router-dom';
import Navbar from './components/Navbar';
import Home from './pages/Home';
import ReportIncident from './pages/ReportIncident';
import Donate from './pages/Donate';

// Heavier pages (AG Grid, Leaflet) load on demand to keep the report form fast on mobile data.
const Dashboard = lazy(() => import('./pages/Dashboard'));
const ReliefMap = lazy(() => import('./pages/ReliefMap'));

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function NotFound() {
  return (
    <div className="mx-auto max-w-xl px-4 py-24 text-center">
      <h1 className="text-3xl font-bold">Page not found</h1>
      <Link to="/" className="btn-primary mt-6">
        Back home
      </Link>
    </div>
  );
}

export default function App() {
  return (
    <div className="flex min-h-screen flex-col">
      <ScrollToTop />
      <Navbar />
      <main className="flex-1">
        <Suspense fallback={<div className="py-24 text-center text-sm text-slate-500">Loading…</div>}>
          <Routes>
            <Route path="/" element={<Home />} />
            <Route path="/report" element={<ReportIncident />} />
            <Route path="/donate" element={<Donate />} />
            <Route path="/map" element={<ReliefMap />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </main>
      <footer className="border-t border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-2 px-4 py-6 text-sm text-slate-500 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>
            ReliefChain · built on{' '}
            <a className="text-brand-700 hover:underline" href="https://github.com/Ray56monds/kampala-flood-sms" target="_blank" rel="noreferrer">
              KampalAlert
            </a>{' '}
            · Kampala, Uganda
          </p>
          <p>Payments run in PayPal sandbox — no real money moves. MIT licensed.</p>
        </div>
      </footer>
    </div>
  );
}
