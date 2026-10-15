import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatUsd } from '../lib/constants';
import { PayPalMark } from '../components/Navbar';

const PRESETS = [10, 25, 50, 100];
const IMPACT = [
  [10, 'clean water and food for a family of five for two days'],
  [25, 'a tarpaulin and bedding for a family whose home flooded'],
  [50, 'a week of food for a household of six'],
  [100, 'emergency relief for a CRITICAL household with infants or elderly members'],
];

let sdkPromise = null;
/** Load the PayPal JS SDK once, with the client id served by our API. */
function loadPayPalSdk(clientId) {
  if (window.paypal) return Promise.resolve(window.paypal);
  sdkPromise ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = `https://www.paypal.com/sdk/js?client-id=${encodeURIComponent(clientId)}&currency=USD&intent=capture&components=buttons`;
    s.async = true;
    s.onload = () => resolve(window.paypal);
    s.onerror = () => {
      sdkPromise = null;
      reject(new Error('Could not load PayPal. Check your connection.'));
    };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

export default function Donate() {
  const [amount, setAmount] = useState(25);
  const [custom, setCustom] = useState('');
  const [donorName, setDonorName] = useState('');
  const [message, setMessage] = useState('');
  const [ppConfig, setPpConfig] = useState(null);
  const [pool, setPool] = useState(null);
  const [state, setState] = useState({ status: 'idle' }); // idle | processing | done | error
  const buttonsRef = useRef(null);

  // Latest values for PayPal callbacks (the buttons are rendered once).
  const latest = useRef({});
  const effectiveAmount = custom ? Number(custom) : amount;
  latest.current = { amount: effectiveAmount, donorName, message };
  const validAmount = Number.isFinite(effectiveAmount) && effectiveAmount >= 1 && effectiveAmount <= 10000;

  useEffect(() => {
    api('/paypal/config').then(setPpConfig).catch((e) => setState({ status: 'error', message: e.message }));
    api('/paypal/pool').then(setPool).catch(() => {});
  }, []);

  async function finishCapture(orderId) {
    setState({ status: 'processing' });
    const { amount: amt, donorName: name, message: msg } = latest.current;
    const res = await api('/paypal/capture-order', { method: 'POST', body: { orderId, amount: amt, donorName: name, message: msg } });
    setPool((p) => ({ ...p, ...res.pool }));
    setState({ status: 'done', donation: res.donation, released: res.releasedPayouts });
  }

  // Render real PayPal buttons when the server has PayPal credentials.
  const formVisible = state.status !== 'done';
  useEffect(() => {
    if (!formVisible || !ppConfig?.configured || !ppConfig.clientId || !buttonsRef.current) return;
    let buttons;
    let cancelled = false;
    loadPayPalSdk(ppConfig.clientId)
      .then((paypal) => {
        if (cancelled || !buttonsRef.current) return;
        buttons = paypal.Buttons({
          style: { layout: 'vertical', color: 'gold', shape: 'rect', label: 'donate', height: 48 },
          createOrder: async () => {
            const { amount: amt } = latest.current;
            if (!(amt >= 1 && amt <= 10000)) throw new Error('Choose an amount between $1 and $10,000.');
            const order = await api('/paypal/create-order', { method: 'POST', body: { amount: amt } });
            return order.id;
          },
          onApprove: async (data) => {
            try {
              await finishCapture(data.orderID);
            } catch (err) {
              setState({ status: 'error', message: err.message });
            }
          },
          onCancel: () => setState({ status: 'idle' }),
          onError: (err) => setState({ status: 'error', message: err?.message || 'PayPal could not complete the payment.' }),
        });
        buttonsRef.current.innerHTML = '';
        buttons.render(buttonsRef.current);
      })
      .catch((err) => setState({ status: 'error', message: err.message }));
    return () => {
      cancelled = true;
      buttons?.close?.().catch(() => {});
    };
  }, [ppConfig, formVisible]);

  async function simulateDonation() {
    try {
      setState({ status: 'processing' });
      const order = await api('/paypal/create-order', { method: 'POST', body: { amount: effectiveAmount } });
      await finishCapture(order.id);
    } catch (err) {
      setState({ status: 'error', message: err.message });
    }
  }

  const impact = [...IMPACT].reverse().find(([min]) => effectiveAmount >= min);

  if (state.status === 'done') {
    const d = state.donation;
    return (
      <div className="mx-auto max-w-xl px-4 py-16 text-center sm:px-6">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-brand-100 text-3xl">💚</div>
        <h1 className="mt-6 text-3xl font-bold">Thank you{d.donorName && d.donorName !== 'Anonymous' ? `, ${d.donorName}` : ''}!</h1>
        <p className="mt-3 text-slate-600">
          {formatUsd(d.amount)} was added to the Kampala relief pool{d.simulated ? ' (simulated — PayPal not configured)' : ' via PayPal sandbox'}.
        </p>
        {state.released > 0 && (
          <p className="mt-4 rounded-xl bg-green-50 p-3 text-sm font-medium text-green-800">
            Your donation immediately released {state.released} queued payout{state.released > 1 ? 's' : ''} to households waiting for funds.
          </p>
        )}
        <p className="mt-4 text-xs text-slate-400">
          PayPal order <span className="font-mono">{d.orderId}</span> · capture <span className="font-mono">{d.captureId}</span>
        </p>
        <div className="mt-8 flex justify-center gap-3">
          <Link to="/map" className="btn-primary">See where it goes</Link>
          <button className="btn-secondary" onClick={() => setState({ status: 'idle' })}>Donate again</button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:px-6 lg:grid-cols-5">
      <div className="lg:col-span-3">
        <h1 className="text-3xl font-bold">Fund the Kampala relief pool</h1>
        <p className="mt-2 text-slate-600">
          Every dollar goes into a shared pool. Our AI decides <em>who</em> needs it most; PayPal Payouts sends it directly to verified households —
          no middlemen, no paperwork. Every disbursement is logged and visible on the coordinator dashboard.
        </p>

        <div className="card mt-8 space-y-6 p-5 sm:p-6">
          <div>
            <span className="label">Choose an amount (USD)</span>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {PRESETS.map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => {
                    setAmount(p);
                    setCustom('');
                  }}
                  className={`rounded-xl border py-3 text-lg font-bold transition ${
                    !custom && amount === p ? 'border-brand-600 bg-brand-50 text-brand-700 ring-2 ring-brand-600/20' : 'border-slate-300 text-slate-700 hover:border-brand-300'
                  }`}
                >
                  ${p}
                </button>
              ))}
            </div>
            <div className="relative mt-3">
              <span className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-slate-400">$</span>
              <input
                type="number"
                min="1"
                max="10000"
                step="1"
                inputMode="decimal"
                className="input pl-7"
                placeholder="Other amount"
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                aria-label="Custom amount"
              />
            </div>
            {impact && validAmount && (
              <p className="mt-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
                <strong>{formatUsd(effectiveAmount)}</strong> can provide {impact[1]}.
              </p>
            )}
            {!validAmount && <p className="field-error">Enter an amount between $1 and $10,000.</p>}
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="donorName">Name on donor wall <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="donorName" className="input" value={donorName} onChange={(e) => setDonorName(e.target.value)} maxLength={60} placeholder="Anonymous" />
            </div>
            <div>
              <label className="label" htmlFor="message">Message <span className="font-normal text-slate-400">(optional)</span></label>
              <input id="message" className="input" value={message} onChange={(e) => setMessage(e.target.value)} maxLength={280} placeholder="Stay strong, Bwaise!" />
            </div>
          </div>

          <div className="border-t border-slate-100 pt-6">
            {state.status === 'error' && <p className="mb-4 rounded-xl bg-red-50 p-3 text-sm font-medium text-red-700">{state.message}</p>}
            {state.status === 'processing' && (
              <p className="mb-4 flex items-center gap-2 text-sm text-slate-600">
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" /> Confirming your payment with PayPal…
              </p>
            )}

            {!ppConfig && <p className="text-sm text-slate-500">Loading payment options…</p>}

            {ppConfig?.configured && (
              <>
                <div ref={buttonsRef} className={!validAmount ? 'pointer-events-none opacity-40' : ''} />
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  <strong>PayPal sandbox:</strong> log in with a sandbox <em>buyer</em> account — no real money is charged.
                </p>
              </>
            )}

            {ppConfig && !ppConfig.configured && (
              <>
                <button className="btn w-full bg-[#ffc439] py-3.5 text-base text-[#003087] hover:bg-[#f2ba36]" onClick={simulateDonation} disabled={!validAmount || state.status === 'processing'}>
                  <PayPalMark className="h-5 w-5" /> Donate {validAmount ? formatUsd(effectiveAmount) : ''} (simulated)
                </button>
                <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                  PayPal credentials are not configured on this server, so donations are <strong>simulated</strong>. Add <code>PAYPAL_CLIENT_ID</code> and{' '}
                  <code>PAYPAL_CLIENT_SECRET</code> to enable the real PayPal sandbox checkout.
                </p>
              </>
            )}
          </div>
        </div>
      </div>

      <aside className="space-y-4 lg:col-span-2">
        <div className="card p-6">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Relief pool</p>
          <p className="mt-1 text-3xl font-bold text-brand-700">{pool ? formatUsd(pool.available) : '—'}</p>
          <p className="text-sm text-slate-500">available now</p>
          {pool && (
            <>
              <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-slate-100">
                <div
                  className="h-full rounded-full bg-brand-500"
                  style={{ width: `${pool.totalDonated ? Math.min(100, ((pool.totalDisbursed + pool.totalReserved) / pool.totalDonated) * 100) : 0}%` }}
                />
              </div>
              <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Total donated</dt>
                <dd className="text-right font-semibold">{formatUsd(pool.totalDonated)}</dd>
                <dt className="text-slate-500">Disbursed</dt>
                <dd className="text-right font-semibold">{formatUsd(pool.totalDisbursed)}</dd>
                <dt className="text-slate-500">Households paid</dt>
                <dd className="text-right font-semibold">{pool.householdsPaid}</dd>
              </dl>
            </>
          )}
        </div>
        <div className="card p-6 text-sm text-slate-600">
          <h2 className="text-base font-semibold text-slate-900">Where your money goes</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5">
            <li>Captured by PayPal Checkout into the ReliefChain pool.</li>
            <li>Reserved for a household only when the AI scores it above 70 and it passes fraud checks.</li>
            <li>Sent with PayPal Payouts directly to the household's PayPal account.</li>
            <li>If a payout fails or is returned, the money goes back into the pool.</li>
          </ol>
        </div>
      </aside>
    </div>
  );
}
