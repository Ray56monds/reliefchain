import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { NEIGHBOURHOODS, PRIORITY_STYLES } from '../lib/constants';
import RiskMap, { MapLegend } from '../components/RiskMap';

const FILTERS = ['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];

export default function ReliefMap() {
  const [reports, setReports] = useState([]);
  const [filter, setFilter] = useState('ALL');
  const [error, setError] = useState('');

  useEffect(() => {
    const load = () =>
      api('/reports/public')
        .then((r) => {
          setReports(r);
          setError('');
        })
        .catch((e) => setError(e.message));
    load();
    const id = setInterval(load, 20000);
    return () => clearInterval(id);
  }, []);

  const visible = filter === 'ALL' ? reports : reports.filter((r) => r.priority === filter);

  const byHood = useMemo(
    () =>
      NEIGHBOURHOODS.map((n) => {
        const rs = reports.filter((r) => r.neighbourhood === n.name);
        return {
          ...n,
          total: rs.length,
          critical: rs.filter((r) => r.priority === 'CRITICAL').length,
          paid: rs.filter((r) => r.status === 'PAID' || r.status === 'PAYOUT_UNCLAIMED').length,
          people: rs.reduce((s, r) => s + (r.householdSize || 0), 0),
        };
      }).sort((a, b) => b.critical - a.critical || b.total - a.total),
    [reports],
  );

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Live relief map</h1>
          <p className="mt-1 text-sm text-slate-500">Every report, coloured by AI priority. Personal details are never shown publicly.</p>
        </div>
        <Link to="/report" className="btn-primary">Report an incident</Link>
      </div>

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap gap-2">
          {FILTERS.map((f) => {
            const count = f === 'ALL' ? reports.length : reports.filter((r) => r.priority === f).length;
            return (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`rounded-full px-3 py-1 text-sm font-medium ring-1 ring-inset transition ${
                  filter === f ? 'bg-slate-900 text-white ring-slate-900' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                }`}
              >
                {f === 'ALL' ? 'All' : PRIORITY_STYLES[f].label} <span className="opacity-60">{count}</span>
              </button>
            );
          })}
        </div>
        <MapLegend />
      </div>

      {error && <p className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-700">{error}</p>}

      <div className="mt-4 grid gap-6 lg:grid-cols-4">
        <div className="card overflow-hidden p-1 lg:col-span-3">
          <RiskMap reports={visible} height={560} />
        </div>
        <aside className="space-y-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Neighbourhoods</h2>
          {byHood.map((n) => (
            <div key={n.name} className="card p-4">
              <div className="flex items-center justify-between">
                <h3 className="font-semibold">{n.name}</h3>
                <span className={`rounded-full px-2 py-0.5 text-xs font-semibold ${n.risk === 'HIGH' ? 'bg-red-50 text-red-700' : 'bg-amber-50 text-amber-700'}`}>
                  {n.risk} risk
                </span>
              </div>
              <dl className="mt-2 grid grid-cols-3 gap-1 text-center text-xs text-slate-500">
                <div>
                  <dd className="text-lg font-bold text-slate-900">{n.total}</dd>
                  <dt>reports</dt>
                </div>
                <div>
                  <dd className="text-lg font-bold text-red-600">{n.critical}</dd>
                  <dt>critical</dt>
                </div>
                <div>
                  <dd className="text-lg font-bold text-brand-600">{n.paid}</dd>
                  <dt>paid</dt>
                </div>
              </dl>
            </div>
          ))}
        </aside>
      </div>
    </div>
  );
}
