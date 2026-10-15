import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../services/firebaseService.js';
import { createOrder, captureOrder, paypalInfo } from '../services/paypalService.js';
import { disburse, refreshPayout, refreshPendingPayouts, processFundingQueue } from '../services/disbursementService.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();
const checkoutLimiter = rateLimit({ windowMs: 60_000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false });

const MIN_DONATION = 1;
const MAX_DONATION = 10_000;

/** Client config: the browser needs the (public) client id to load the PayPal JS SDK. */
router.get('/config', (_req, res) => res.json(paypalInfo()));

/** Public relief pool stats — the transparency number on the home page. */
router.get('/pool', async (_req, res, next) => {
  try {
    const [pool, reports, txs] = await Promise.all([db.getPool(), db.listReports({ limit: 1000 }), db.listTransactions({ limit: 1000 })]);
    const paid = reports.filter((r) => r.status === 'PAID' || r.status === 'PAYOUT_UNCLAIMED');
    res.json({
      ...pool,
      reports: reports.length,
      householdsPaid: paid.length,
      peopleReached: paid.reduce((s, r) => s + (r.householdSize || 0), 0),
      donations: txs.filter((t) => t.type === 'DONATION').length,
      ...paypalInfo(),
      clientId: undefined,
    });
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Donations — PayPal Orders v2
// ---------------------------------------------------------------------------
router.post('/create-order', checkoutLimiter, async (req, res, next) => {
  try {
    const amount = Math.round(Number(req.body?.amount) * 100) / 100;
    if (!Number.isFinite(amount) || amount < MIN_DONATION || amount > MAX_DONATION) {
      return res.status(400).json({ error: `Donation must be between $${MIN_DONATION} and $${MAX_DONATION}.` });
    }
    const order = await createOrder(amount);
    res.status(201).json({ id: order.id, status: order.status, simulated: Boolean(order.simulated) });
  } catch (err) {
    next(err);
  }
});

router.post('/capture-order', checkoutLimiter, async (req, res, next) => {
  try {
    const { orderId, amount, donorName, message } = req.body || {};
    if (!orderId) return res.status(400).json({ error: 'orderId is required' });

    // Idempotent: a retried capture of the same order never double-counts the pool.
    const existing = await db.getDonation(orderId);
    if (existing) return res.json({ donation: existing, pool: await db.getPool(), duplicate: true });

    const capture = await captureOrder(orderId, amount);
    if (capture.status !== 'COMPLETED' || capture.amount <= 0) {
      return res.status(402).json({ error: `Payment not completed (status: ${capture.status}).`, capture });
    }
    if (capture.currency !== 'USD') return res.status(400).json({ error: `Unsupported currency ${capture.currency}` });

    const donation = {
      orderId,
      captureId: capture.captureId,
      amount: capture.amount, // amount confirmed by PayPal, not the browser
      currency: capture.currency,
      donorName: String(donorName || capture.payerName || 'Anonymous').slice(0, 60),
      message: String(message || '').slice(0, 280),
      simulated: capture.simulated,
    };
    const pool = await db.recordDonation(orderId, donation);
    await db.createTransaction({
      type: 'DONATION',
      amount: donation.amount,
      currency: donation.currency,
      status: 'COMPLETED',
      paypalOrderId: orderId,
      paypalTransactionId: capture.captureId,
      donorName: donation.donorName,
      payerEmail: capture.payerEmail || null,
      simulated: capture.simulated,
    });

    // New money in the pool → release any eligible households waiting for funds.
    const released = await processFundingQueue();
    res.json({ donation, pool: released.length ? await db.getPool() : pool, releasedPayouts: released.length });
  } catch (err) {
    next(err);
  }
});

router.get('/donations/recent', async (_req, res, next) => {
  try {
    const donations = await db.listDonations({ limit: 10 });
    res.json(donations.map(({ donorName, amount, message, createdAt, simulated }) => ({ donorName, amount, message, createdAt, simulated })));
  } catch (err) {
    next(err);
  }
});

// ---------------------------------------------------------------------------
// Disbursements — PayPal Payouts v1 (coordinator only)
// ---------------------------------------------------------------------------

/** POST /api/paypal/payout { reportId } — run the AI gate and pay out if it passes. */
router.post('/payout', requireAdmin, async (req, res, next) => {
  try {
    const { reportId } = req.body || {};
    if (!reportId) return res.status(400).json({ error: 'reportId is required' });
    const result = await disburse(reportId, { trigger: 'manual', actor: req.actor });
    const status = result.error ? 502 : result.transaction ? 201 : 409;
    res.status(status).json(result);
  } catch (err) {
    next(err);
  }
});

router.post('/payout/:transactionId/refresh', requireAdmin, async (req, res, next) => {
  try {
    res.json(await refreshPayout(req.params.transactionId));
  } catch (err) {
    next(err);
  }
});

router.post('/payouts/refresh', requireAdmin, async (_req, res, next) => {
  try {
    const refreshed = await refreshPendingPayouts();
    const released = await processFundingQueue();
    res.json({ refreshed, released: released.length });
  } catch (err) {
    next(err);
  }
});

router.get('/transactions', requireAdmin, async (_req, res, next) => {
  try {
    res.json(await db.listTransactions({ limit: 1000 }));
  } catch (err) {
    next(err);
  }
});

export default router;
