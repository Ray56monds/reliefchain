import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { NEIGHBOURHOODS, VULNERABLE_GROUPS, FRAUD_FLAG_LABELS, formatUsd } from '../lib/constants';
import VulnerabilityBadge, { ScoreRing } from '../components/VulnerabilityBadge';
import PaymentStatus from '../components/PaymentStatus';

const EMPTY = {
  name: '',
  neighbourhood: '',
  disasterType: 'flood',
  description: '',
  householdSize: 1,
  vulnerableMembers: Object.fromEntries(VULNERABLE_GROUPS.map((g) => [g.key, 0])),
  recipientEmail: import.meta.env.VITE_DEMO_RECIPIENT_EMAIL || '',
  phone: '',
};

/** Downscale photos on the device so uploads work on slow mobile data and stay within Firestore limits. */
function compressImage(file, maxSide = 1024, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      const scale = Math.min(1, maxSide / Math.max(img.width, img.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(img.width * scale);
      canvas.height = Math.round(img.height * scale);
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Could not read that image.'));
    };
    img.src = url;
  });
}

const STAGES = ['Checking records for duplicates…', 'AI is assessing vulnerability…', 'Applying payout rules…'];

export default function ReportIncident() {
  const [form, setForm] = useState(EMPTY);
  const [photo, setPhoto] = useState(null);
  const [errors, setErrors] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [stage, setStage] = useState(0);
  const [result, setResult] = useState(null);
  const [formError, setFormError] = useState('');

  const set = (k, v) => setForm((f) => ({ ...f, [k]: v }));
  const setVulnerable = (k, v) => setForm((f) => ({ ...f, vulnerableMembers: { ...f.vulnerableMembers, [k]: Math.max(0, Math.min(50, v)) } }));

  async function onPhoto(e) {
    const file = e.target.files?.[0];
    if (!file) return setPhoto(null);
    try {
      setPhoto(await compressImage(file));
      setErrors((er) => ({ ...er, photo: undefined }));
    } catch (err) {
      setErrors((er) => ({ ...er, photo: err.message }));
    }
  }

  function validate() {
    const e = {};
    if (form.name.trim().length < 2) e.name = 'Enter the name of the head of household.';
    if (!form.neighbourhood) e.neighbourhood = 'Choose your neighbourhood.';
    if (form.description.trim().length < 10) e.description = 'Tell us what happened (at least a sentence).';
    if (!(form.householdSize >= 1)) e.householdSize = 'At least 1 person.';
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(form.recipientEmail.trim())) e.recipientEmail = 'Enter a valid PayPal email.';
    const vuln = Object.values(form.vulnerableMembers).reduce((a, b) => a + b, 0);
    if (vuln > form.householdSize * 2) e.vulnerableMembers = 'That is more vulnerable members than people in the household.';
    return e;
  }

  async function submit(e) {
    e.preventDefault();
    setFormError('');
    const e2 = validate();
    setErrors(e2);
    if (Object.keys(e2).length) return;

    setSubmitting(true);
    setStage(0);
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 1400);
    try {
      const data = await api('/reports', { method: 'POST', body: { ...form, photo } });
      setResult(data);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      if (err.body?.fields) setErrors(err.body.fields);
      setFormError(err.message);
    } finally {
      clearInterval(timer);
      setSubmitting(false);
    }
  }

  if (result) return <ReportResult result={result} onAnother={() => { setResult(null); setForm(EMPTY); setPhoto(null); }} />;

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <h1 className="text-3xl font-bold">Report a flood incident</h1>
      <p className="mt-2 text-slate-600">
        Tell us what happened to your household. Our AI assesses every report within seconds, and the most vulnerable households are paid first
        through PayPal. Volunteers can submit on behalf of neighbours.
      </p>

      <form onSubmit={submit} noValidate className="mt-8 space-y-6">
        <fieldset className="card space-y-5 p-5 sm:p-6">
          <legend className="sr-only">Household</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="name">Head of household</label>
              <input id="name" className="input" value={form.name} onChange={(e) => set('name', e.target.value)} autoComplete="name" placeholder="e.g. Nalwoga Sarah" />
              {errors.name && <p className="field-error">{errors.name}</p>}
            </div>
            <div>
              <label className="label" htmlFor="neighbourhood">Neighbourhood</label>
              <select id="neighbourhood" className="input" value={form.neighbourhood} onChange={(e) => set('neighbourhood', e.target.value)}>
                <option value="">Select…</option>
                {NEIGHBOURHOODS.map((n) => (
                  <option key={n.name} value={n.name}>
                    {n.name} {n.risk === 'HIGH' ? '— high flood risk' : ''}
                  </option>
                ))}
              </select>
              {errors.neighbourhood && <p className="field-error">{errors.neighbourhood}</p>}
            </div>
          </div>

          <div>
            <span className="label">What happened?</span>
            <div className="mb-3 flex flex-wrap gap-2">
              {['flood', 'storm', 'landslide', 'fire', 'other'].map((t) => (
                <button
                  type="button"
                  key={t}
                  onClick={() => set('disasterType', t)}
                  className={`rounded-full px-3 py-1 text-sm font-medium capitalize ring-1 ring-inset transition ${
                    form.disasterType === t ? 'bg-brand-600 text-white ring-brand-600' : 'bg-white text-slate-600 ring-slate-300 hover:bg-slate-50'
                  }`}
                >
                  {t}
                </button>
              ))}
            </div>
            <textarea
              id="description"
              rows={5}
              className="input"
              value={form.description}
              onChange={(e) => set('description', e.target.value)}
              placeholder="e.g. Water entered our house at 2am, up to the knees. Our mattresses and food are destroyed and the children are sleeping at a neighbour's."
              maxLength={2000}
            />
            <div className="mt-1 flex justify-between text-xs text-slate-400">
              {errors.description ? <p className="field-error mt-0">{errors.description}</p> : <span>Be specific — damage, injuries, what you need most.</span>}
              <span>{form.description.length}/2000</span>
            </div>
          </div>

          <div>
            <label className="label" htmlFor="photo">Photo of the damage <span className="font-normal text-slate-400">(optional, helps verification)</span></label>
            <div className="flex items-center gap-4">
              <input id="photo" type="file" accept="image/*" capture="environment" onChange={onPhoto} className="block w-full text-sm text-slate-600 file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:text-sm file:font-semibold file:text-brand-700 hover:file:bg-brand-100" />
              {photo && <img src={photo} alt="Preview" className="h-16 w-16 rounded-lg object-cover ring-1 ring-slate-200" />}
            </div>
            {errors.photo && <p className="field-error">{errors.photo}</p>}
          </div>
        </fieldset>

        <fieldset className="card space-y-5 p-5 sm:p-6">
          <legend className="sr-only">Who lives here</legend>
          <div>
            <label className="label" htmlFor="householdSize">People in the household</label>
            <Stepper id="householdSize" value={form.householdSize} onChange={(v) => set('householdSize', Math.max(1, Math.min(50, v)))} min={1} />
            {errors.householdSize && <p className="field-error">{errors.householdSize}</p>}
          </div>
          <div>
            <span className="label">Vulnerable members</span>
            <div className="grid gap-3 sm:grid-cols-2">
              {VULNERABLE_GROUPS.map((g) => (
                <div key={g.key} className="flex items-center justify-between gap-3 rounded-xl border border-slate-200 px-3 py-2">
                  <span className="text-sm text-slate-700">{g.label}</span>
                  <Stepper small value={form.vulnerableMembers[g.key]} onChange={(v) => setVulnerable(g.key, v)} min={0} label={g.label} />
                </div>
              ))}
            </div>
            {errors.vulnerableMembers && <p className="field-error">{errors.vulnerableMembers}</p>}
          </div>
        </fieldset>

        <fieldset className="card space-y-5 p-5 sm:p-6">
          <legend className="sr-only">Payment</legend>
          <div className="grid gap-5 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="recipientEmail">PayPal email to receive funds</label>
              <input id="recipientEmail" type="email" className="input" value={form.recipientEmail} onChange={(e) => set('recipientEmail', e.target.value)} autoComplete="email" placeholder="you@example.com" />
              {errors.recipientEmail ? (
                <p className="field-error">{errors.recipientEmail}</p>
              ) : (
                <p className="mt-1 text-xs text-slate-500">No PayPal account yet? You can claim the money by signing up with this email.</p>
              )}
            </div>
            <div>
              <label className="label" htmlFor="phone">Phone <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="phone" type="tel" className="input" value={form.phone} onChange={(e) => set('phone', e.target.value)} autoComplete="tel" placeholder="+256 7XX XXX XXX" />
            </div>
          </div>
          <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-500">
            Your name, email and phone are only visible to ReliefChain coordinators. The public map shows neighbourhood and priority only.
            Submitting false reports takes help away from families who need it.
          </p>
        </fieldset>

        {formError && <p className="rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{formError}</p>}

        <button type="submit" className="btn-primary w-full py-3.5 text-base" disabled={submitting}>
          {submitting ? (
            <>
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
              {STAGES[stage]}
            </>
          ) : (
            'Submit report'
          )}
        </button>
      </form>
    </div>
  );
}

function Stepper({ id, value, onChange, min = 0, small, label }) {
  const size = small ? 'h-8 w-8' : 'h-10 w-10';
  return (
    <div className="inline-flex items-center gap-2">
      <button type="button" className={`${size} rounded-lg border border-slate-300 text-lg font-semibold text-slate-600 hover:bg-slate-50`} onClick={() => onChange(value - 1)} disabled={value <= min} aria-label={`Decrease ${label || ''}`}>
        −
      </button>
      <input
        id={id}
        type="number"
        inputMode="numeric"
        className={`${small ? 'w-10' : 'w-16'} rounded-lg border border-slate-300 py-1.5 text-center text-sm font-semibold`}
        value={value}
        min={min}
        onChange={(e) => onChange(Number.parseInt(e.target.value || '0', 10))}
        aria-label={label}
      />
      <button type="button" className={`${size} rounded-lg border border-slate-300 text-lg font-semibold text-slate-600 hover:bg-slate-50`} onClick={() => onChange(value + 1)} aria-label={`Increase ${label || ''}`}>
        +
      </button>
    </div>
  );
}

const OUTCOMES = {
  PAID: { title: 'Funds sent', tone: 'bg-green-50 text-green-900 ring-green-200', body: 'Emergency funds were sent to your PayPal account. Check your email.' },
  PAYOUT_PENDING: { title: 'Payout on its way', tone: 'bg-sky-50 text-sky-900 ring-sky-200', body: 'PayPal is processing your payment. You will receive an email from PayPal shortly.' },
  PAYOUT_UNCLAIMED: { title: 'Funds sent — claim them', tone: 'bg-violet-50 text-violet-900 ring-violet-200', body: 'PayPal sent the funds to your email. Open the PayPal email to claim them within 30 days.' },
  AWAITING_FUNDS: { title: 'Approved — queued for funding', tone: 'bg-amber-50 text-amber-900 ring-amber-200', body: 'Your household qualifies. You will be paid automatically, most vulnerable first, as soon as donations arrive.' },
  FLAGGED: { title: 'Sent for review', tone: 'bg-orange-50 text-orange-900 ring-orange-200', body: 'A ReliefChain coordinator will check your report, usually within a few hours. You do not need to resubmit.' },
  BELOW_THRESHOLD: { title: 'Report received', tone: 'bg-slate-50 text-slate-900 ring-slate-200', body: 'Your report did not qualify for automatic emergency cash, but it is recorded and shared with coordinators and partners for follow-up support.' },
  PAYOUT_FAILED: { title: 'Payout could not be sent', tone: 'bg-red-50 text-red-900 ring-red-200', body: 'Something went wrong sending the payment. A coordinator has been alerted and will retry.' },
};

function ReportResult({ result, onAnother }) {
  const { report, payout } = result;
  const outcome = OUTCOMES[report.status] || OUTCOMES.BELOW_THRESHOLD;
  const ai = report.ai || {};

  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
      <div className={`rounded-2xl p-6 ring-1 ${outcome.tone}`}>
        <div className="flex items-center gap-2">
          <PaymentStatus status={report.status} simulated={payout?.simulated} />
        </div>
        <h1 className="mt-3 text-2xl font-bold">{outcome.title}</h1>
        <p className="mt-2">{outcome.body}</p>
        {payout && (
          <p className="mt-3 text-lg font-semibold">
            {formatUsd(payout.amount)} via PayPal {payout.simulated && <span className="text-sm font-normal">(simulated — PayPal not configured)</span>}
          </p>
        )}
      </div>

      <div className="card mt-6 flex flex-col gap-6 p-6 sm:flex-row sm:items-center">
        <ScoreRing score={ai.vulnerability_score} priority={ai.priority} size={120} />
        <div>
          <p className="text-sm font-medium text-slate-500">AI vulnerability assessment</p>
          <div className="mt-1">
            <VulnerabilityBadge priority={ai.priority} size="lg" />
          </div>
          <p className="mt-3 text-slate-700">{ai.reasoning}</p>
          {ai.needs?.length > 0 && <p className="mt-2 text-sm text-slate-500">Priority needs: {ai.needs.map((n) => n.replace(/_/g, ' ')).join(', ')}</p>}
          {report.status === 'FLAGGED' && (
            <p className="mt-2 text-xs text-slate-500">Reports are checked against {Object.keys(FRAUD_FLAG_LABELS).length} fraud signals to keep the pool fair.</p>
          )}
        </div>
      </div>

      <p className="mt-6 text-sm text-slate-500">
        Your reference: <span className="font-mono font-semibold text-slate-700">{report.id}</span> — keep this to follow up with a coordinator.
      </p>
      <div className="mt-6 flex flex-wrap gap-3">
        <button className="btn-primary" onClick={onAnother}>Submit another report</button>
        <Link to="/map" className="btn-secondary">View relief map</Link>
      </div>
    </div>
  );
}
