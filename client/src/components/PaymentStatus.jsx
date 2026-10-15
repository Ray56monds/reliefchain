import { STATUS_STYLES } from '../lib/constants';

/** Status pill for reports (PAID, FLAGGED, …) and PayPal transactions (SUCCESS, UNCLAIMED, …). */
export default function PaymentStatus({ status, simulated }) {
  const s = STATUS_STYLES[status] || { label: status || 'Unknown', tone: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' };
  return (
    <span className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${s.tone}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${s.dot}`} />
      {s.label}
      {simulated && <span className="font-normal opacity-70">(sim)</span>}
    </span>
  );
}
