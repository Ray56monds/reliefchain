// Mirrors server/data/neighbourhoods.js
export const NEIGHBOURHOODS = [
  { name: 'Bwaise', lat: 0.3538, lon: 32.559, risk: 'HIGH' },
  { name: 'Kinawataka', lat: 0.3275, lon: 32.6201, risk: 'HIGH' },
  { name: 'Nakivubo', lat: 0.3103, lon: 32.5867, risk: 'HIGH' },
  { name: 'Makindye', lat: 0.2946, lon: 32.5825, risk: 'MEDIUM' },
  { name: 'Kawempe', lat: 0.3728, lon: 32.5619, risk: 'MEDIUM' },
  { name: 'Rubaga', lat: 0.3047, lon: 32.5522, risk: 'MEDIUM' },
];

export const KAMPALA_CENTER = [0.3245, 32.5795];

export const VULNERABLE_GROUPS = [
  { key: 'elderly', label: 'Elderly (60+)' },
  { key: 'children', label: 'Children under 5' },
  { key: 'disabled', label: 'Living with disability' },
  { key: 'pregnant', label: 'Pregnant / nursing' },
  { key: 'chronically_ill', label: 'Chronically ill' },
];

export const PRIORITY_STYLES = {
  CRITICAL: { label: 'Critical', color: '#dc2626', badge: 'bg-red-100 text-red-800 ring-red-600/20' },
  HIGH: { label: 'High', color: '#d97706', badge: 'bg-amber-100 text-amber-800 ring-amber-600/20' },
  MEDIUM: { label: 'Medium', color: '#16a34a', badge: 'bg-green-100 text-green-800 ring-green-600/20' },
  LOW: { label: 'Low', color: '#6b7280', badge: 'bg-slate-100 text-slate-700 ring-slate-500/20' },
};

export const STATUS_STYLES = {
  PAID: { label: 'Paid', tone: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
  SUCCESS: { label: 'Success', tone: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
  COMPLETED: { label: 'Completed', tone: 'bg-green-100 text-green-800', dot: 'bg-green-500' },
  PAYOUT_PENDING: { label: 'Payout pending', tone: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500' },
  PENDING: { label: 'Pending', tone: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500' },
  CREATED: { label: 'Created', tone: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500' },
  PROCESSING: { label: 'Processing', tone: 'bg-sky-100 text-sky-800', dot: 'bg-sky-500' },
  PAYOUT_UNCLAIMED: { label: 'Unclaimed', tone: 'bg-violet-100 text-violet-800', dot: 'bg-violet-500' },
  UNCLAIMED: { label: 'Unclaimed', tone: 'bg-violet-100 text-violet-800', dot: 'bg-violet-500' },
  AWAITING_FUNDS: { label: 'Awaiting funds', tone: 'bg-amber-100 text-amber-800', dot: 'bg-amber-500' },
  FLAGGED: { label: 'Under review', tone: 'bg-orange-100 text-orange-800', dot: 'bg-orange-500' },
  BELOW_THRESHOLD: { label: 'Below threshold', tone: 'bg-slate-100 text-slate-700', dot: 'bg-slate-400' },
  PAYOUT_FAILED: { label: 'Payout failed', tone: 'bg-red-100 text-red-800', dot: 'bg-red-500' },
  FAILED: { label: 'Failed', tone: 'bg-red-100 text-red-800', dot: 'bg-red-500' },
  RETURNED: { label: 'Returned', tone: 'bg-red-100 text-red-800', dot: 'bg-red-500' },
  BLOCKED: { label: 'Blocked', tone: 'bg-red-100 text-red-800', dot: 'bg-red-500' },
  REJECTED: { label: 'Rejected', tone: 'bg-slate-200 text-slate-600', dot: 'bg-slate-500' },
};

export const FRAUD_FLAG_LABELS = {
  duplicate_location: 'Burst of reports from one location',
  duplicate_recipient: 'PayPal email already used recently',
  duplicate_household: 'Same household already reported',
  suspicious_timing: 'Many submissions from one device',
  inconsistent_details: 'Details contradict each other',
  implausible_household: 'Implausible household size',
  photo_mismatch: 'Photo does not match report',
  low_detail_report: 'Too little detail to verify',
};

export const formatUsd = (n) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 }).format(Number(n) || 0);

export function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.round((Date.now() - Date.parse(iso)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** Stable small offset so multiple reports in one neighbourhood don't stack on one pin. */
export function jitter(id, lat, lon) {
  let h = 0;
  for (const c of String(id)) h = (h * 31 + c.charCodeAt(0)) | 0;
  const angle = (Math.abs(h) % 360) * (Math.PI / 180);
  const radius = 0.002 + (Math.abs(h >> 8) % 60) / 10000;
  return [lat + Math.sin(angle) * radius, lon + Math.cos(angle) * radius];
}
