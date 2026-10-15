import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatUsd, timeAgo } from '../lib/constants';
import StatCard from '../components/StatCard';
import { PayPalMark } from '../components/Navbar';

const STEPS = [
  {
    n: '1',
    title: 'Report',
    body: 'A household (or a community volunteer on their behalf) reports flood damage in under two minutes from any phone — neighbourhood, household size, who is most vulnerable and a photo.',
  },
  {
    n: '2',
    title: 'AI triage',
    body: 'GPT-4o reads the report and photo, scores vulnerability 0–100, recommends an amount and screens for fraud. Our own records add duplicate and burst checks the AI cannot override.',
  },
  {
    n: '3',
    title: 'PayPal payout',
    body: 'Scores above 70 with no fraud flags are paid automatically through PayPal Payouts — usually within minutes. Everything else goes to a coordinator, not a dead end.',
  },
];

export default function Home() {
  const [pool, setPool] = useState(null);
  const [donations, setDonations] = useState([]);

  useEffect(() => {
    api('/paypal/pool').then(setPool).catch(() => {});
    api('/paypal/donations/recent').then(setDonations).catch(() => {});
  }, []);

  return (
    <>
      {/* Hero */}
      <section className="relative overflow-hidden bg-brand-900 text-white">
        <div
          className="absolute inset-0 opacity-30"
          style={{ background: 'radial-gradient(circle at 80% 20%, #16936f 0, transparent 45%), radial-gradient(circle at 10% 90%, #0f6e56 0, transparent 40%)' }}
        />
        <div className="relative mx-auto grid max-w-7xl gap-10 px-4 py-16 sm:px-6 lg:grid-cols-5 lg:py-24">
          <div className="lg:col-span-3">
            <p className="inline-flex items-center gap-2 rounded-full bg-white/10 px-3 py-1 text-xs font-semibold text-brand-100 ring-1 ring-white/20">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" /> Rainy season response · Kampala, Uganda
            </p>
            <h1 className="mt-5 text-4xl font-extrabold leading-tight text-white sm:text-5xl">
              When the Nakivubo channel overflows, relief should arrive in hours — not weeks.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-brand-100">
              ReliefChain turns flood reports into emergency cash. AI triages every household by vulnerability, and PayPal pays the most at-risk
              families first — transparently, with every dollar traceable.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/report" className="btn bg-white text-brand-700 hover:bg-brand-50">
                Report a flood incident
              </Link>
              <Link to="/donate" className="btn border border-white/30 text-white hover:bg-white/10">
                <PayPalMark className="h-4 w-4" /> Donate to the relief pool
              </Link>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3 self-end lg:col-span-2">
            <StatCard accent label="Available in pool" value={pool ? formatUsd(pool.available) : '—'} hint="Ready to disburse" />
            <StatCard label="Disbursed" value={pool ? formatUsd(pool.totalDisbursed) : '—'} hint="Via PayPal Payouts" />
            <StatCard label="Households paid" value={pool?.householdsPaid ?? '—'} hint={`${pool?.peopleReached ?? 0} people reached`} />
            <StatCard label="Reports triaged" value={pool?.reports ?? '—'} hint="Scored by AI" />
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
        <div className="grid gap-10 lg:grid-cols-2">
          <div>
            <h2 className="text-3xl font-bold">The coordination gap</h2>
            <p className="mt-4 text-slate-600">
              Every rainy season, flash floods hit Kampala's low-lying informal settlements — Bwaise, Kinawataka, Nakivubo — where drainage
              channels overflow within an hour of heavy rain. Families lose food stock, bedding, market goods and sometimes their homes.
            </p>
            <p className="mt-4 text-slate-600">
              Warnings now reach people (that's what KampalAlert does). But money doesn't. Relief is coordinated by phone calls and paper lists;
              the most vulnerable — elderly residents, mothers with infants, people with disabilities — are often the last to be counted.
            </p>
            <p className="mt-4 text-slate-600">
              ReliefChain is the next layer: an auditable pipeline from <strong>report</strong> to <strong>verified cash in hand</strong>, with AI
              deciding <em>who first</em> and PayPal handling <em>how</em>.
            </p>
          </div>
          <div className="grid gap-4 sm:grid-cols-3 lg:grid-cols-1">
            {[
              ['3', 'high-risk zones covered at launch: Bwaise, Kinawataka, Nakivubo'],
              ['< 2 min', 'to submit a report on a basic smartphone'],
              ['> 70', 'AI vulnerability score + no fraud flags = automatic PayPal payout'],
            ].map(([big, text]) => (
              <div key={big} className="card flex items-center gap-4 p-5">
                <span className="text-2xl font-extrabold text-brand-600">{big}</span>
                <span className="text-sm text-slate-600">{text}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="border-y border-slate-200 bg-white">
        <div className="mx-auto max-w-7xl px-4 py-16 sm:px-6">
          <h2 className="text-center text-3xl font-bold">How it works</h2>
          <div className="mt-10 grid gap-6 md:grid-cols-3">
            {STEPS.map((s) => (
              <div key={s.n} className="relative rounded-2xl border border-slate-200 p-6">
                <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-600 text-lg font-bold text-white">{s.n}</span>
                <h3 className="mt-4 text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-slate-600">{s.body}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Donors + CTA */}
      <section className="mx-auto grid max-w-7xl gap-8 px-4 py-16 sm:px-6 lg:grid-cols-2">
        <div className="card p-6">
          <h2 className="text-xl font-bold">Recent donors</h2>
          {donations.length === 0 ? (
            <p className="mt-4 text-sm text-slate-500">Be the first to fund the relief pool.</p>
          ) : (
            <ul className="mt-4 divide-y divide-slate-100">
              {donations.map((d, i) => (
                <li key={i} className="flex items-start justify-between gap-4 py-3">
                  <div>
                    <p className="text-sm font-medium">{d.donorName}</p>
                    {d.message && <p className="text-sm text-slate-500">“{d.message}”</p>}
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-brand-700">{formatUsd(d.amount)}</p>
                    <p className="text-xs text-slate-400">{timeAgo(d.createdAt)}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col justify-center rounded-2xl bg-brand-50 p-8">
          <h2 className="text-2xl font-bold">See where help is needed right now</h2>
          <p className="mt-3 text-slate-600">
            The live relief map shows every report across Kampala, coloured by AI priority. No personal details are ever shown publicly.
          </p>
          <div className="mt-6 flex flex-wrap gap-3">
            <Link to="/map" className="btn-primary">
              Open relief map
            </Link>
            <Link to="/dashboard" className="btn-secondary">
              Coordinator dashboard
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
