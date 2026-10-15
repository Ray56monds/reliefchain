import VulnerabilityBadge, { ScoreRing } from './VulnerabilityBadge';
import PaymentStatus from './PaymentStatus';
import { FRAUD_FLAG_LABELS, VULNERABLE_GROUPS, formatUsd, timeAgo } from '../lib/constants';

/** Full report view with the AI triage result. `children` renders coordinator actions. */
export default function ReportCard({ report, photo, children, compact = false }) {
  const ai = report.ai || {};
  const flags = report.fraudFlags || [];
  const vulnerable = VULNERABLE_GROUPS.filter((g) => report.vulnerableMembers?.[g.key] > 0);

  return (
    <article className="card overflow-hidden">
      <div className="flex flex-col gap-4 p-5 sm:flex-row">
        <ScoreRing score={ai.vulnerability_score ?? 0} priority={ai.priority} size={compact ? 72 : 96} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="text-base font-semibold">{report.name || 'Household'}</h3>
            <VulnerabilityBadge priority={ai.priority} />
            <PaymentStatus status={report.status} />
          </div>
          <p className="mt-1 text-sm text-slate-500">
            {report.neighbourhood} · household of {report.householdSize} · {timeAgo(report.createdAt)}
            <span className="ml-1 font-mono text-xs text-slate-400">{report.id}</span>
          </p>

          <p className={`mt-3 text-sm text-slate-700 ${compact ? 'line-clamp-3' : ''}`}>{report.description}</p>

          {vulnerable.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {vulnerable.map((g) => (
                <span key={g.key} className="rounded-md bg-slate-100 px-2 py-0.5 text-xs text-slate-700">
                  {report.vulnerableMembers[g.key]} × {g.label}
                </span>
              ))}
            </div>
          )}

          <div className="mt-4 rounded-xl bg-brand-50/60 p-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <span className="font-semibold text-brand-900">
                AI triage <span className="font-normal text-brand-700">· {ai.source === 'openai' ? ai.model : 'heuristic'}</span>
              </span>
              <span className="font-semibold text-brand-900">Recommended: {formatUsd(ai.recommended_amount_usd)}</span>
            </div>
            <p className="mt-1 text-slate-700">{ai.reasoning}</p>
            {ai.photo_assessment && report.hasPhoto && <p className="mt-1 text-xs text-slate-600">📷 {ai.photo_assessment}</p>}
            {ai.needs?.length > 0 && (
              <p className="mt-1 text-xs text-slate-600">Needs: {ai.needs.map((n) => n.replace(/_/g, ' ')).join(', ')}</p>
            )}
          </div>

          {flags.length > 0 && (
            <ul className="mt-3 space-y-1">
              {flags.map((f) => (
                <li key={f} className="flex items-center gap-2 text-sm text-orange-800">
                  <svg className="h-4 w-4 shrink-0" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
                    <path d="M8.3 2.6c.7-1.3 2.7-1.3 3.4 0l6 10.9c.7 1.3-.2 2.9-1.7 2.9H4c-1.5 0-2.4-1.6-1.7-2.9l6-10.9ZM10 7a1 1 0 0 0-1 1v3a1 1 0 1 0 2 0V8a1 1 0 0 0-1-1Zm0 8a1 1 0 1 0 0-2 1 1 0 0 0 0 2Z" />
                  </svg>
                  {FRAUD_FLAG_LABELS[f] || f.replace(/_/g, ' ')}
                  <span className="text-xs text-orange-600/70">
                    ({report.fraudSources?.system?.includes(f) ? 'records check' : 'AI'})
                  </span>
                </li>
              ))}
            </ul>
          )}

          {report.statusReason && <p className="mt-3 text-xs text-slate-500">{report.statusReason}</p>}
          {report.recipientEmail && (
            <p className="mt-1 text-xs text-slate-500">
              Payout to <span className="font-mono">{report.recipientEmail}</span>
              {report.phone && <> · {report.phone}</>}
            </p>
          )}
        </div>
        {photo && (
          <img src={photo} alt="Damage reported by household" className="h-40 w-full rounded-xl object-cover sm:h-32 sm:w-44" />
        )}
      </div>
      {children && <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 bg-slate-50/70 px-5 py-3">{children}</div>}
    </article>
  );
}
