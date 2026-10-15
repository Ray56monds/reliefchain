import { useEffect, useState } from 'react';
import { Link, NavLink } from 'react-router-dom';
import { api } from '../lib/api';
import logo from '../logo.svg';

const LINKS = [
  { to: '/report', label: 'Report incident' },
  { to: '/donate', label: 'Donate' },
  { to: '/map', label: 'Relief map' },
  { to: '/dashboard', label: 'Coordinator' },
];

export function SandboxBadge({ health, className = '' }) {
  const mode = health?.integrations?.paypal;
  if (!mode) return null;
  const live = mode === 'live';
  const simulated = mode === 'simulated';
  return (
    <span
      title={
        simulated
          ? 'PayPal credentials not configured — payments are simulated locally.'
          : live
            ? 'Live PayPal'
            : 'All PayPal calls go to the PayPal sandbox — no real money moves.'
      }
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${
        live ? 'bg-green-50 text-green-800 ring-green-600/30' : 'bg-amber-50 text-amber-800 ring-amber-500/40'
      } ${className}`}
    >
      <PayPalMark className="h-3.5 w-3.5" />
      {simulated ? 'PayPal: simulated' : live ? 'PayPal live' : 'PayPal sandbox · test mode'}
    </span>
  );
}

export function PayPalMark({ className }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden="true">
      <path fill="#003087" d="M7.1 21.3H3.6a.5.5 0 0 1-.5-.6L5.8 3.4c.1-.5.5-.9 1-.9h6.4c3.3 0 5.4 1.7 4.9 4.9-.6 3.9-3.2 5.6-6.6 5.6H9.4c-.5 0-.9.4-1 .9z" />
      <path fill="#0070e0" d="M19.5 8.1c-.6 3.6-3.1 5.5-6.6 5.5h-1.2c-.5 0-.9.4-1 .9l-.9 5.9c0 .3-.3.6-.7.6H6.5l-.1.6c0 .3.2.5.5.5h3c.4 0 .8-.3.9-.8l.7-4.6c.1-.4.4-.8.9-.8h.6c3 0 5.3-1.2 6-4.8.3-1.4.2-2.6-.5-3.4z" />
    </svg>
  );
}

export default function Navbar() {
  const [open, setOpen] = useState(false);
  const [health, setHealth] = useState(null);

  useEffect(() => {
    api('/health').then(setHealth).catch(() => setHealth(null));
  }, []);

  const linkClass = ({ isActive }) =>
    `rounded-lg px-3 py-2 text-sm font-medium transition ${
      isActive ? 'bg-brand-50 text-brand-700' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
    }`;

  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white/90 backdrop-blur">
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link to="/" className="flex items-center gap-2.5" onClick={() => setOpen(false)}>
          <img src={logo} alt="" className="h-8 w-8" />
          <span className="text-lg font-bold tracking-tight text-slate-900">
            Relief<span className="text-brand-600">Chain</span>
          </span>
        </Link>

        <div className="hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <NavLink key={l.to} to={l.to} className={linkClass}>
              {l.label}
            </NavLink>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <SandboxBadge health={health} className="hidden sm:inline-flex" />
          <button
            className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label="Toggle menu"
            aria-expanded={open}
          >
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              {open ? <path d="M6 18 18 6M6 6l12 12" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
            </svg>
          </button>
        </div>
      </nav>

      {open && (
        <div className="border-t border-slate-200 bg-white px-4 pb-4 pt-2 md:hidden">
          <div className="flex flex-col gap-1">
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to} className={linkClass} onClick={() => setOpen(false)}>
                {l.label}
              </NavLink>
            ))}
          </div>
          <SandboxBadge health={health} className="mt-3" />
        </div>
      )}
    </header>
  );
}
