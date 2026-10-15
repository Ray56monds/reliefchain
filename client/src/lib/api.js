// API base: same origin in dev (Vite proxy) and single-service deploys;
// VITE_API_URL for split client/server deploys (Render may give a bare host).
const raw = import.meta.env.VITE_API_URL || '';
export const API_BASE = raw && !/^https?:\/\//.test(raw) ? `https://${raw}` : raw.replace(/\/$/, '');

const ADMIN_KEY_STORAGE = 'reliefchain.adminKey';

export const adminKey = {
  get() {
    try {
      return localStorage.getItem(ADMIN_KEY_STORAGE) || '';
    } catch {
      return '';
    }
  },
  set(key) {
    try {
      if (key) localStorage.setItem(ADMIN_KEY_STORAGE, key);
      else localStorage.removeItem(ADMIN_KEY_STORAGE);
    } catch {
      /* storage unavailable */
    }
  },
};

export class ApiError extends Error {
  constructor(message, status, body) {
    super(message);
    this.status = status;
    this.body = body;
  }
}

export async function api(path, { method = 'GET', body, admin = false } = {}) {
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (admin) headers['x-admin-key'] = adminKey.get();

  let res;
  try {
    res = await fetch(`${API_BASE}/api${path}`, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
  } catch {
    throw new ApiError('Cannot reach the ReliefChain server. Check your connection and try again.', 0);
  }
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(data.error || `Request failed (${res.status})`, res.status, data);
  return data;
}
