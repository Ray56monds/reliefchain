import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Persistence layer. Uses Firebase Firestore when credentials are configured,
 * otherwise a local JSON-file store with the same API so the app runs out of the box.
 *
 * Collections:
 *   reports        — disaster reports + AI triage result + payout status
 *   report_photos  — photo data URLs, kept apart so list queries stay small
 *   transactions   — every PayPal payout / donation event
 *   donations      — captured PayPal orders (doc id = PayPal order id, for idempotency)
 *   pool/main      — relief pool ledger { totalDonated, totalDisbursed, totalReserved }
 */

const POOL_DOC = 'main';
const newId = (prefix) => `${prefix}_${crypto.randomBytes(6).toString('hex')}`;
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------------------
// Firestore backend
// ---------------------------------------------------------------------------
async function createFirestoreBackend() {
  const { initializeApp, cert, getApps } = await import('firebase-admin/app');
  const { getFirestore, FieldValue } = await import('firebase-admin/firestore');

  if (!getApps().length) {
    initializeApp({
      credential: cert({
        projectId: config.firebase.projectId,
        clientEmail: config.firebase.clientEmail,
        privateKey: config.firebase.privateKey,
      }),
    });
  }
  const db = getFirestore();
  db.settings({ ignoreUndefinedProperties: true });
  const poolRef = db.collection('pool').doc(POOL_DOC);

  return {
    name: 'firestore',
    async insert(collection, doc, id) {
      const docId = id || doc.id || newId(collection.slice(0, 3));
      const data = { ...doc, id: docId };
      await db.collection(collection).doc(docId).set(data);
      return data;
    },
    async get(collection, id) {
      const snap = await db.collection(collection).doc(id).get();
      return snap.exists ? snap.data() : null;
    },
    async update(collection, id, patch) {
      await db.collection(collection).doc(id).set(patch, { merge: true });
      return this.get(collection, id);
    },
    async list(collection, { limit = 500, where } = {}) {
      let q = db.collection(collection);
      if (where) q = q.where(where[0], where[1], where[2]);
      q = q.orderBy('createdAt', 'desc').limit(limit);
      const snap = await q.get().catch(async (err) => {
        // where + orderBy on different fields needs a composite index; fall back to unordered.
        if (!where) throw err;
        return db.collection(collection).where(where[0], where[1], where[2]).limit(limit).get();
      });
      return snap.docs.map((d) => d.data()).sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
    },
    async getPool() {
      const snap = await poolRef.get();
      return normalisePool(snap.exists ? snap.data() : {});
    },
    async addDonation(amount) {
      await poolRef.set({ totalDonated: FieldValue.increment(amount), updatedAt: nowIso() }, { merge: true });
      return this.getPool();
    },
    /** Atomically reserve funds for a payout. Returns false if the pool can't cover it. */
    async reserve(amount) {
      return db.runTransaction(async (tx) => {
        const pool = normalisePool((await tx.get(poolRef)).data() || {});
        if (pool.available + 1e-9 < amount) return false;
        tx.set(poolRef, { totalReserved: round2(pool.totalReserved + amount), updatedAt: nowIso() }, { merge: true });
        return true;
      });
    },
    /** Move a reservation to disbursed (success) or release it back to the pool (failure). */
    async settle(amount, success) {
      return db.runTransaction(async (tx) => {
        const pool = normalisePool((await tx.get(poolRef)).data() || {});
        const patch = { totalReserved: round2(Math.max(0, pool.totalReserved - amount)), updatedAt: nowIso() };
        if (success) patch.totalDisbursed = round2(pool.totalDisbursed + amount);
        tx.set(poolRef, patch, { merge: true });
      });
    },
    /** A payout already counted as disbursed was returned/reversed by PayPal. */
    async reverse(amount) {
      await poolRef.set({ totalDisbursed: FieldValue.increment(-amount), updatedAt: nowIso() }, { merge: true });
    },
  };
}

// ---------------------------------------------------------------------------
// Local JSON-file backend (demo / no-credentials mode)
// ---------------------------------------------------------------------------
function createLocalBackend() {
  const file = path.join(config.dataDir, 'db.json');
  let state = { collections: {}, pool: null };
  try {
    state = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    /* first run */
  }
  if (!state.pool) {
    state.pool = { totalDonated: config.relief.demoSeedPoolUsd, totalDisbursed: 0, totalReserved: 0, seeded: true };
  }

  let timer = null;
  const persist = () => {
    clearTimeout(timer);
    timer = setTimeout(() => {
      fs.mkdirSync(config.dataDir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(state, null, 2));
    }, 150);
  };
  const coll = (name) => (state.collections[name] ||= {});
  const clone = (v) => (v == null ? v : structuredClone(v));
  const ops = {
    '==': (a, b) => a === b,
    '>=': (a, b) => a >= b,
    '<=': (a, b) => a <= b,
    '>': (a, b) => a > b,
    '<': (a, b) => a < b,
  };

  return {
    name: 'local',
    async insert(collection, doc, id) {
      const docId = id || doc.id || newId(collection.slice(0, 3));
      const data = { ...doc, id: docId };
      coll(collection)[docId] = data;
      persist();
      return clone(data);
    },
    async get(collection, id) {
      return clone(coll(collection)[id] || null);
    },
    async update(collection, id, patch) {
      const existing = coll(collection)[id] || { id };
      coll(collection)[id] = { ...existing, ...patch };
      persist();
      return clone(coll(collection)[id]);
    },
    async list(collection, { limit = 500, where } = {}) {
      let rows = Object.values(coll(collection));
      if (where) rows = rows.filter((r) => ops[where[1]](r[where[0]], where[2]));
      rows.sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
      return clone(rows.slice(0, limit));
    },
    async getPool() {
      return normalisePool(state.pool);
    },
    async addDonation(amount) {
      state.pool.totalDonated = round2(state.pool.totalDonated + amount);
      persist();
      return normalisePool(state.pool);
    },
    async reserve(amount) {
      const pool = normalisePool(state.pool);
      if (pool.available + 1e-9 < amount) return false;
      state.pool.totalReserved = round2(pool.totalReserved + amount);
      persist();
      return true;
    },
    async settle(amount, success) {
      state.pool.totalReserved = round2(Math.max(0, state.pool.totalReserved - amount));
      if (success) state.pool.totalDisbursed = round2(state.pool.totalDisbursed + amount);
      persist();
    },
    async reverse(amount) {
      state.pool.totalDisbursed = round2(Math.max(0, state.pool.totalDisbursed - amount));
      persist();
    },
  };
}

// ---------------------------------------------------------------------------

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function normalisePool(raw) {
  const totalDonated = round2(raw.totalDonated);
  const totalDisbursed = round2(raw.totalDisbursed);
  const totalReserved = round2(raw.totalReserved);
  return {
    totalDonated,
    totalDisbursed,
    totalReserved,
    available: round2(totalDonated - totalDisbursed - totalReserved),
    seeded: Boolean(raw.seeded),
  };
}

let backendPromise = null;
export function getDb() {
  if (!backendPromise) {
    backendPromise = (config.firebase.enabled ? createFirestoreBackend() : Promise.resolve(createLocalBackend())).then(
      (db) => {
        console.log(`[db] using ${db.name === 'firestore' ? 'Firebase Firestore' : 'local JSON store (server/.data)'}`);
        return db;
      },
    );
  }
  return backendPromise;
}

// ---------------------------------------------------------------------------
// Domain helpers used by the routes
// ---------------------------------------------------------------------------
export const db = {
  async createReport(report, photo) {
    const d = await getDb();
    const id = newId('rpt');
    const saved = await d.insert('reports', { ...report, id, hasPhoto: Boolean(photo), createdAt: nowIso(), updatedAt: nowIso() }, id);
    if (photo) await d.insert('report_photos', { id, dataUrl: photo, createdAt: saved.createdAt }, id);
    return saved;
  },
  async updateReport(id, patch) {
    return (await getDb()).update('reports', id, { ...patch, updatedAt: nowIso() });
  },
  async getReport(id) {
    return (await getDb()).get('reports', id);
  },
  async getReportPhoto(id) {
    return (await (await getDb()).get('report_photos', id))?.dataUrl || null;
  },
  async listReports(opts) {
    return (await getDb()).list('reports', opts);
  },
  async createTransaction(tx) {
    const id = newId('txn');
    return (await getDb()).insert('transactions', { ...tx, id, createdAt: nowIso(), updatedAt: nowIso() }, id);
  },
  async updateTransaction(id, patch) {
    return (await getDb()).update('transactions', id, { ...patch, updatedAt: nowIso() });
  },
  async getTransaction(id) {
    return (await getDb()).get('transactions', id);
  },
  async listTransactions(opts) {
    return (await getDb()).list('transactions', opts);
  },
  async getDonation(orderId) {
    return (await getDb()).get('donations', orderId);
  },
  async recordDonation(orderId, donation) {
    const d = await getDb();
    await d.insert('donations', { ...donation, createdAt: nowIso() }, orderId);
    return d.addDonation(donation.amount);
  },
  async listDonations(opts) {
    return (await getDb()).list('donations', opts);
  },
  async getPool() {
    return (await getDb()).getPool();
  },
  async reserveFunds(amount) {
    return (await getDb()).reserve(round2(amount));
  },
  async settleFunds(amount, success) {
    return (await getDb()).settle(round2(amount), success);
  },
  async reverseDisbursement(amount) {
    return (await getDb()).reverse(round2(amount));
  },
  async backendName() {
    return (await getDb()).name;
  },
};

export { round2 };
