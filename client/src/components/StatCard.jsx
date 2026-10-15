export default function StatCard({ label, value, hint, accent = false }) {
  return (
    <div className={`card p-4 sm:p-5 ${accent ? 'border-brand-200 bg-brand-600 text-white' : ''}`}>
      <p className={`text-xs font-medium uppercase tracking-wide ${accent ? 'text-brand-100' : 'text-slate-500'}`}>{label}</p>
      <p className={`mt-1 text-2xl font-bold sm:text-3xl ${accent ? 'text-white' : 'text-slate-900'}`}>{value}</p>
      {hint && <p className={`mt-1 text-xs ${accent ? 'text-brand-100' : 'text-slate-500'}`}>{hint}</p>}
    </div>
  );
}
