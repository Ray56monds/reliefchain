import { useCallback, useEffect, useMemo, useState } from 'react';
import { AgGridProvider, AgGridReact } from 'ag-grid-react';
import { AllCommunityModule, themeQuartz } from 'ag-grid-community';
import { api, adminKey } from '../lib/api';
import { formatUsd, timeAgo } from '../lib/constants';
import StatCard from '../components/StatCard';
import ReportCard from '../components/ReportCard';
import VulnerabilityBadge from '../components/VulnerabilityBadge';
import PaymentStatus from '../components/PaymentStatus';
import RiskMap, { MapLegend } from '../components/RiskMap';

const modules = [AllCommunityModule];

const gridTheme = themeQuartz.withParams({
  accentColor: '#0f6e56',
  borderRadius: 10,
  wrapperBorderRadius: 16,
  headerBackgroundColor: '#f8fafc',
  headerFontWeight: 600,
  fontFamily: 'inherit',
  fontSize: 13,
  rowHoverColor: '#e8f5f0',
  selectedRowBackgroundColor: '#c8e8db',
});

const PRIORITY_ORDER = { CRITICAL: 4, HIGH: 3, MEDIUM: 2, LOW: 1 };

// ---- AG Grid cell renderers ----
const PriorityCell = ({ value }) => (value ? <VulnerabilityBadge priority={value} /> : null);
const StatusCell = ({ value, data }) => <PaymentStatus status={value} simulated={data?.simulated} />;
const ScoreCell = ({ value }) => (
  <div className="flex h-full items-center gap-2">
    <div className="h-1.5 w-14 overflow-hidden rounded-full bg-slate-100">
      <div className="h-full rounded-full" style={{ width: `${value}%`, background: value > 84 ? '#dc2626' : value > 69 ? '#d97706' : value > 39 ? '#16a34a' : '#6b7280' }} />
    </div>
    <span className="font-mono font-semibold">{value}</span>
  </div>
);
const FlagsCell = ({ value }) =>
  value?.length ? <span className="rounded bg-orange-100 px-1.5 py-0.5 text-xs font-semibold text-orange-800">{value.length} flag{value.length > 1 ? 's' : ''}</span> : <span className="text-slate-300">—</span>;
const MonoCell = ({ value }) => <span className="font-mono text-xs text-slate-500">{value}</span>;
const dateFormatter = ({ value }) => (value ? new Date(value).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '');

export default function Dashboard() {
  const [key, setKey] = useState(adminKey.get());
  const [authed, setAuthed] = useState(false);
  const [authError, setAuthError] = useState('');

  const [reports, setReports] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [pool, setPool] = useState(null);
  const [briefing, setBriefing] = useState(null);
  const [briefingLoading, setBriefingLoading] = useState(false);
  const [selected, setSelected] = useState(null);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [busy, setBusy] = useState('');
  const [toast, setToast] = useState(null);
  const [quickFilter, setQuickFilter] = useState('');
  const [tab, setTab] = useState('reports');

  const notify = (message, tone = 'ok') => {
    setToast({ message, tone });
    setTimeout(() => setToast(null), 5000);
  };

  const load = useCallback(async () => {
    const [r, t, p] = await Promise.all([api('/reports', { admin: true }), api('/paypal/transactions', { admin: true }), api('/paypal/pool')]);
    setReports(r);
    setTransactions(t);
    setPool(p);
    return r;
  }, []);

  async function login(e) {
    e?.preventDefault();
    adminKey.set(key);
    try {
      await load();
      setAuthed(true);
      setAuthError('');
    } catch (err) {
      setAuthed(false);
      setAuthError(err.status === 401 ? 'That coordinator key was not accepted.' : err.message);
    }
  }

  useEffect(() => {
    if (adminKey.get()) login();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Live refresh while the dashboard is open.
  useEffect(() => {
    if (!authed) return;
    const id = setInterval(() => load().catch(() => {}), 15000);
    return () => clearInterval(id);
  }, [authed, load]);

  // Keep the detail panel in sync with fresh data.
  useEffect(() => {
    if (selected) setSelected((s) => reports.find((r) => r.id === s.id) || s);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reports]);

  async function openReport(r) {
    setSelected(r);
    setSelectedPhoto(null);
    if (r.hasPhoto) api(`/reports/${r.id}/photo`, { admin: true }).then((d) => setSelectedPhoto(d.dataUrl)).catch(() => {});
  }

  async function review(report, action) {
    const note = action === 'reject' ? window.prompt('Reason for rejecting (shared with the audit log):', '') : '';
    if (note === null) return;
    setBusy(report.id + action);
    try {
      const res = await api(`/reports/${report.id}/review`, { method: 'POST', admin: true, body: { action, note } });
      const status = res.report?.status;
      notify(action === 'reject' ? 'Report rejected.' : `Approved — now ${status?.replace(/_/g, ' ').toLowerCase()}.`);
      await load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function retryPayout(report) {
    setBusy(report.id + 'pay');
    try {
      const res = await api('/paypal/payout', { method: 'POST', admin: true, body: { reportId: report.id } });
      notify(res.transaction ? `PayPal payout ${res.transaction.status.toLowerCase()} — ${formatUsd(res.transaction.amount)}.` : res.gate?.reason || 'No payout made.');
    } catch (err) {
      notify(err.body?.gate?.reason || err.body?.error || err.message, 'error');
    } finally {
      await load().catch(() => {});
      setBusy('');
    }
  }

  async function syncPayPal() {
    setBusy('sync');
    try {
      const res = await api('/paypal/payouts/refresh', { method: 'POST', admin: true });
      notify(`Checked ${res.refreshed} in-flight payout(s) with PayPal${res.released ? `, released ${res.released} queued` : ''}.`);
      await load();
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBusy('');
    }
  }

  async function generateBriefing() {
    setBriefingLoading(true);
    try {
      setBriefing(await api('/ai/briefing', { method: 'POST', admin: true }));
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setBriefingLoading(false);
    }
  }

  const flagged = reports.filter((r) => r.status === 'FLAGGED');
  const awaiting = reports.filter((r) => r.status === 'AWAITING_FUNDS');

  const reportCols = useMemo(
    () => [
      { field: 'id', headerName: 'Report ID', cellRenderer: MonoCell, minWidth: 150 },
      { field: 'neighbourhood', headerName: 'Neighbourhood', filter: true, minWidth: 160 },
      { field: 'name', headerName: 'Household', minWidth: 140 },
      { field: 'householdSize', headerName: 'People', minWidth: 105, filter: 'agNumberColumnFilter' },
      { field: 'ai.vulnerability_score', headerName: 'AI Score', sort: 'desc', cellRenderer: ScoreCell, minWidth: 140, filter: 'agNumberColumnFilter' },
      {
        field: 'ai.priority',
        headerName: 'Priority',
        cellRenderer: PriorityCell,
        minWidth: 130,
        filter: true,
        comparator: (a, b) => (PRIORITY_ORDER[a] || 0) - (PRIORITY_ORDER[b] || 0),
      },
      { field: 'ai.recommended_amount_usd', headerName: 'Amount', valueFormatter: ({ value }) => formatUsd(value), minWidth: 120, filter: 'agNumberColumnFilter' },
      { field: 'status', headerName: 'PayPal Status', cellRenderer: StatusCell, minWidth: 170, filter: true },
      { field: 'fraudFlags', headerName: 'Fraud', cellRenderer: FlagsCell, minWidth: 100, comparator: (a, b) => (a?.length || 0) - (b?.length || 0) },
      { field: 'createdAt', headerName: 'Timestamp', valueFormatter: dateFormatter, minWidth: 140, filter: 'agDateColumnFilter' },
    ],
    [],
  );

  const txCols = useMemo(
    () => [
      { field: 'createdAt', headerName: 'Time', valueFormatter: dateFormatter, sort: 'desc', minWidth: 140 },
      {
        field: 'type',
        headerName: 'Type',
        width: 120,
        filter: true,
        cellRenderer: ({ value }) => (
          <span className={`rounded px-1.5 py-0.5 text-xs font-semibold ${value === 'DONATION' ? 'bg-brand-50 text-brand-700' : 'bg-indigo-50 text-indigo-700'}`}>
            {value === 'DONATION' ? '↓ Donation' : '↑ Payout'}
          </span>
        ),
      },
      { field: 'amount', headerName: 'Amount', valueFormatter: ({ value }) => formatUsd(value), width: 110 },
      { field: 'status', headerName: 'Status', cellRenderer: StatusCell, minWidth: 140, filter: true },
      { headerName: 'Party', valueGetter: ({ data }) => (data.type === 'DONATION' ? data.donorName : data.recipientEmail), minWidth: 190 },
      { field: 'reportId', headerName: 'Report', cellRenderer: MonoCell, minWidth: 150 },
      { headerName: 'PayPal reference', valueGetter: ({ data }) => data.batchId || data.paypalOrderId, cellRenderer: MonoCell, minWidth: 190 },
      { field: 'paypalTransactionId', headerName: 'PayPal txn', cellRenderer: MonoCell, minWidth: 170 },
      { field: 'error', headerName: 'Error', minWidth: 200, tooltipField: 'error' },
    ],
    [],
  );

  const defaultColDef = useMemo(() => ({ sortable: true, resizable: true, flex: 1 }), []);

  if (!authed) {
    return (
      <div className="mx-auto max-w-md px-4 py-20 sm:px-6">
        <form onSubmit={login} className="card p-6">
          <h1 className="text-2xl font-bold">Coordinator dashboard</h1>
          <p className="mt-2 text-sm text-slate-600">
            Reports contain personal details, so this area is limited to ReliefChain coordinators.
          </p>
          <label className="label mt-6" htmlFor="key">Coordinator key</label>
          <input id="key" type="password" className="input" value={key} onChange={(e) => setKey(e.target.value)} placeholder="ADMIN_API_KEY" autoFocus />
          {authError && <p className="field-error">{authError}</p>}
          <button className="btn-primary mt-4 w-full">Open dashboard</button>
          <p className="mt-4 text-xs text-slate-400">
            Local demo key: <code className="font-mono">reliefchain-demo-admin</code>
          </p>
        </form>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Coordinator dashboard</h1>
          <p className="mt-1 text-sm text-slate-500">Live triage and PayPal disbursement across Kampala · refreshes every 15s</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button className="btn-secondary" onClick={syncPayPal} disabled={busy === 'sync'}>
            {busy === 'sync' ? 'Syncing…' : '↻ Sync PayPal payouts'}
          </button>
          <button className="btn-secondary" onClick={() => { adminKey.set(''); setAuthed(false); }}>
            Sign out
          </button>
        </div>
      </div>

      {/* Pool */}
      <section className="mt-6 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <StatCard accent label="Available" value={pool ? formatUsd(pool.available) : '—'} hint={pool?.totalReserved ? `${formatUsd(pool.totalReserved)} reserved in flight` : 'Ready to disburse'} />
        <StatCard label="Total donated" value={pool ? formatUsd(pool.totalDonated) : '—'} hint={`${pool?.donations ?? 0} PayPal donation(s)${pool?.seeded ? ' + demo seed' : ''}`} />
        <StatCard label="Disbursed" value={pool ? formatUsd(pool.totalDisbursed) : '—'} hint={`${pool?.householdsPaid ?? 0} households · ${pool?.peopleReached ?? 0} people`} />
        <StatCard label="Needs review" value={flagged.length} hint="Fraud-flagged reports" />
        <StatCard label="Awaiting funds" value={awaiting.length} hint={awaiting.length ? formatUsd(awaiting.reduce((s, r) => s + r.ai.recommended_amount_usd, 0)) + ' needed' : 'Queue is clear'} />
      </section>

      {/* AI briefing */}
      <section className="card mt-6 p-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold">AI situation briefing</h2>
            <p className="text-sm text-slate-500">GPT-4o summarises hotspots, needs and risks across all open reports.</p>
          </div>
          <button className="btn-primary" onClick={generateBriefing} disabled={briefingLoading}>
            {briefingLoading ? 'Analysing reports…' : briefing ? 'Regenerate' : 'Generate briefing'}
          </button>
        </div>
        {briefing && (
          <div className="mt-4 grid gap-4 border-t border-slate-100 pt-4 lg:grid-cols-3">
            <div className="lg:col-span-3">
              <p className="font-medium text-slate-900">{briefing.headline}</p>
              <p className="text-xs text-slate-400">
                {briefing.source === 'openai' ? 'Generated by OpenAI' : 'Heuristic summary (no OpenAI key)'} · {timeAgo(briefing.generatedAt)}
              </p>
            </div>
            <BriefingList title="Hotspots" items={briefing.hotspots?.map((h) => `${h.neighbourhood}: ${h.summary}`)} />
            <BriefingList title="Recommended actions" items={briefing.recommendations} />
            <BriefingList title="Risks to watch" items={briefing.risks} />
          </div>
        )}
      </section>

      {/* Review queue */}
      {flagged.length > 0 && (
        <section className="mt-8">
          <h2 className="text-lg font-semibold">
            Review queue <span className="ml-1 rounded-full bg-orange-100 px-2 py-0.5 text-sm text-orange-800">{flagged.length}</span>
          </h2>
          <p className="text-sm text-slate-500">
            Flagged reports are never paid automatically. Approving clears the flags and re-runs the AI payout gate (score must still be above 70).
          </p>
          <div className="mt-4 grid gap-4 xl:grid-cols-2">
            {flagged.map((r) => (
              <ReportCard key={r.id} report={r} compact>
                <button className="btn-primary" disabled={!!busy} onClick={() => review(r, 'approve')}>
                  {busy === r.id + 'approve' ? 'Approving…' : 'Verified — approve'}
                </button>
                <button className="btn-danger" disabled={!!busy} onClick={() => review(r, 'reject')}>
                  Reject
                </button>
                <button className="btn-secondary" onClick={() => openReport(r)}>Details</button>
              </ReportCard>
            ))}
          </div>
        </section>
      )}

      {/* Tables */}
      <section className="mt-8">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="inline-flex rounded-xl bg-slate-100 p-1">
            {[
              ['reports', `Reports (${reports.length})`],
              ['transactions', `PayPal transactions (${transactions.length})`],
            ].map(([id, label]) => (
              <button key={id} onClick={() => setTab(id)} className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${tab === id ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}>
                {label}
              </button>
            ))}
          </div>
          <input className="input max-w-xs" placeholder="Search…" value={quickFilter} onChange={(e) => setQuickFilter(e.target.value)} />
        </div>

        <div className="mt-3" style={{ height: 520 }}>
          <AgGridProvider modules={modules}>
            {tab === 'reports' ? (
              <AgGridReact
                theme={gridTheme}
                rowData={reports}
                columnDefs={reportCols}
                defaultColDef={defaultColDef}
                getRowId={({ data }) => data.id}
                quickFilterText={quickFilter}
                pagination
                paginationPageSize={20}
                paginationPageSizeSelector={[20, 50, 100]}
                rowSelection={{ mode: 'singleRow', checkboxes: false, enableClickSelection: true }}
                onRowClicked={({ data }) => openReport(data)}
                overlayNoRowsTemplate="No reports yet — submit one from the Report page."
              />
            ) : (
              <AgGridReact
                theme={gridTheme}
                rowData={transactions}
                columnDefs={txCols}
                defaultColDef={defaultColDef}
                getRowId={({ data }) => data.id}
                quickFilterText={quickFilter}
                pagination
                paginationPageSize={20}
                paginationPageSizeSelector={[20, 50, 100]}
                tooltipShowDelay={300}
                overlayNoRowsTemplate="No PayPal transactions yet."
              />
            )}
          </AgGridProvider>
        </div>
      </section>

      {/* Selected report */}
      {selected && (
        <section className="mt-8">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold">Report detail</h2>
            <button className="text-sm text-slate-500 hover:text-slate-800" onClick={() => setSelected(null)}>Close ✕</button>
          </div>
          <ReportCard report={selected} photo={selectedPhoto}>
            <span className="mr-auto text-xs text-slate-500">{selected.gate?.reason || (selected.gate?.eligible ? 'Eligible for payout.' : '')}</span>
            {['PAYOUT_FAILED', 'AWAITING_FUNDS'].includes(selected.status) && (
              <button className="btn-primary" disabled={!!busy} onClick={() => retryPayout(selected)}>
                {busy === selected.id + 'pay' ? 'Sending…' : 'Retry PayPal payout'}
              </button>
            )}
            {['FLAGGED', 'BELOW_THRESHOLD', 'AWAITING_FUNDS', 'PAYOUT_FAILED'].includes(selected.status) && (
              <button className="btn-danger" disabled={!!busy} onClick={() => review(selected, 'reject')}>Reject</button>
            )}
            {selected.status === 'FLAGGED' && (
              <button className="btn-secondary" disabled={!!busy} onClick={() => review(selected, 'approve')}>Approve</button>
            )}
          </ReportCard>
        </section>
      )}

      {/* Map */}
      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Reports across Kampala</h2>
          <MapLegend />
        </div>
        <div className="card overflow-hidden p-1">
          <RiskMap reports={reports.filter((r) => r.status !== 'REJECTED')} height={440} onSelect={(r) => openReport(r)} />
        </div>
      </section>

      {toast && (
        <div
          role="status"
          className={`fixed inset-x-4 bottom-4 z-50 mx-auto max-w-md rounded-xl px-4 py-3 text-sm font-medium shadow-lg sm:inset-x-auto sm:right-6 ${
            toast.tone === 'error' ? 'bg-red-600 text-white' : 'bg-slate-900 text-white'
          }`}
        >
          {toast.message}
        </div>
      )}
    </div>
  );
}

function BriefingList({ title, items = [] }) {
  return (
    <div>
      <h3 className="text-xs font-semibold uppercase tracking-wide text-slate-500">{title}</h3>
      <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
        {items.length ? items.map((t, i) => <li key={i} className="flex gap-2"><span className="text-brand-600">•</span>{t}</li>) : <li className="text-slate-400">None</li>}
      </ul>
    </div>
  );
}
