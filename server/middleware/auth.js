import crypto from 'node:crypto';
import { config } from '../config.js';

const safeEqual = (a, b) => {
  const ab = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
};

/**
 * Coordinator (admin) auth. Send the key as `x-admin-key: <key>` or `Authorization: Bearer <key>`.
 * Protects anything that exposes personal data or moves money on demand.
 */
export function requireAdmin(req, res, next) {
  const header = req.get('authorization') || '';
  const key = req.get('x-admin-key') || (header.startsWith('Bearer ') ? header.slice(7) : '');
  if (!key || !safeEqual(key, config.adminApiKey)) {
    return res.status(401).json({ error: 'Coordinator access required. Provide a valid x-admin-key header.' });
  }
  req.actor = 'coordinator';
  next();
}
