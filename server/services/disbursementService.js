import { config } from '../config.js';
import { db } from './firebaseService.js';
import { createPayout, getPayoutStatus, FAILED_ITEM_STATUSES } from './paypalService.js';

/**
 * The AI-gated disbursement engine.
 *
 * Gate: a PayPal payout is released only when
 *   1. the AI vulnerability score is > PAYOUT_SCORE_THRESHOLD (default 70),
 *   2. the report carries no fraud flags (AI or deterministic), and
 *   3. the relief pool can cover the amount (funds are reserved atomically first).
 *
 * Report status lifecycle:
 *   FLAGGED ─(coordinator approves)─▶ re-gated   FLAGGED ─(rejects)─▶ REJECTED
 *   BELOW_THRESHOLD (no automatic payout)
 *   AWAITING_FUNDS ─(donation arrives)─▶ PAYOUT_PENDING ─▶ PAID | PAYOUT_UNCLAIMED | PAYOUT_FAILED
 */

export const STATUS = {
  FLAGGED: 'FLAGGED',
  BELOW_THRESHOLD: 'BELOW_THRESHOLD',
  AWAITING_FUNDS: 'AWAITING_FUNDS',
  PAYOUT_PENDING: 'PAYOUT_PENDING',
  PAID: 'PAID',
  PAYOUT_UNCLAIMED: 'PAYOUT_UNCLAIMED',
  PAYOUT_FAILED: 'PAYOUT_FAILED',
  REJECTED: 'REJECTED',
};

const inFlight = new Set(); // guards against double-clicks / concurrent triggers per report

export function evaluateGate(report) {
  const score = report.ai?.vulnerability_score ?? 0;
  const flags = report.fraudFlags || [];
  if (report.status === STATUS.REJECTED) return { eligible: false, status: STATUS.REJECTED, reason: 'Report was rejected by a coordinator.' };
  if ([STATUS.PAID, STATUS.PAYOUT_PENDING, STATUS.PAYOUT_UNCLAIMED].includes(report.status)) {
    return { eligible: false, status: report.status, reason: 'A payout has already been sent for this report.' };
  }
  if (flags.length) return { eligible: false, status: STATUS.FLAGGED, reason: `Held for review: ${flags.join(', ')}.` };
  if (score <= config.relief.payoutThreshold) {
    return {
      eligible: false,
      status: STATUS.BELOW_THRESHOLD,
      reason: `Score ${score} is not above the automatic payout threshold of ${config.relief.payoutThreshold}.`,
    };
  }
  return { eligible: true };
}

/** Run the gate and, if it passes, send the PayPal payout. Returns { report, transaction?, gate }. */
export async function disburse(reportId, { trigger = 'auto', actor = 'system' } = {}) {
  if (inFlight.has(reportId)) return { report: await db.getReport(reportId), gate: { eligible: false, reason: 'Payout already in progress.' } };
  inFlight.add(reportId);
  try {
    let report = await db.getReport(reportId);
    if (!report) throw Object.assign(new Error('Report not found'), { status: 404 });

    const gate = evaluateGate(report);
    if (!gate.eligible) {
      if (gate.status && gate.status !== report.status) report = await db.updateReport(reportId, { status: gate.status, statusReason: gate.reason });
      return { report, gate };
    }

    const amount = report.ai.recommended_amount_usd;
    const reserved = await db.reserveFunds(amount);
    if (!reserved) {
      const pool = await db.getPool();
      report = await db.updateReport(reportId, {
        status: STATUS.AWAITING_FUNDS,
        statusReason: `Eligible — queued until the relief pool can cover $${amount.toFixed(2)} (available: $${pool.available.toFixed(2)}).`,
      });
      return { report, gate: { eligible: true, queued: true, reason: report.statusReason } };
    }

    const attempt = (report.payoutAttempts || 0) + 1;
    let tx = await db.createTransaction({
      type: 'PAYOUT',
      reportId,
      neighbourhood: report.neighbourhood,
      amount,
      currency: 'USD',
      recipientEmail: report.recipientEmail,
      status: 'CREATED',
      trigger,
      actor,
      attempt,
      aiScore: report.ai.vulnerability_score,
      priority: report.ai.priority,
      settled: false,
    });

    try {
      const payout = await createPayout({
        reportId: attempt > 1 ? `${reportId}-${attempt}` : reportId,
        amount,
        recipientEmail: report.recipientEmail,
        neighbourhood: report.neighbourhood,
      });
      tx = await db.updateTransaction(tx.id, {
        batchId: payout.batchId,
        senderBatchId: payout.senderBatchId,
        payoutItemId: payout.payoutItemId || null,
        paypalTransactionId: payout.transactionId || null,
        batchStatus: payout.batchStatus,
        status: payout.itemStatus || payout.batchStatus || 'PENDING',
        simulated: payout.simulated,
      });
      report = await db.updateReport(reportId, {
        status: STATUS.PAYOUT_PENDING,
        statusReason: `PayPal payout of $${amount.toFixed(2)} submitted.`,
        payoutAttempts: attempt,
        transactionId: tx.id,
      });
      // Simulated payouts complete instantly; real ones are polled via refreshPayout().
      if (payout.itemStatus === 'SUCCESS') ({ report, tx } = await applyPayoutStatus(tx, payout));
      return { report, transaction: tx, gate };
    } catch (err) {
      await db.settleFunds(amount, false); // release the reservation
      tx = await db.updateTransaction(tx.id, { status: 'FAILED', error: err.message, paypalDebugId: err.debugId || null });
      report = await db.updateReport(reportId, {
        status: STATUS.PAYOUT_FAILED,
        statusReason: `PayPal payout failed: ${err.message}`,
        payoutAttempts: attempt,
        transactionId: tx.id,
      });
      return { report, transaction: tx, gate, error: err.message };
    }
  } finally {
    inFlight.delete(reportId);
  }
}

/** Fold a PayPal payout status into the transaction, report and pool ledger. */
async function applyPayoutStatus(tx, status) {
  const item = status.itemStatus;
  const patch = {
    batchStatus: status.batchStatus,
    status: item || status.batchStatus,
    payoutItemId: status.payoutItemId || tx.payoutItemId || null,
    paypalTransactionId: status.transactionId || tx.paypalTransactionId || null,
    lastCheckedAt: new Date().toISOString(),
  };
  if (status.errors) patch.error = status.errors.message || JSON.stringify(status.errors);

  let reportPatch = null;
  // SUCCESS = in the recipient's PayPal account. UNCLAIMED = sent; recipient must claim within 30 days.
  if ((item === 'SUCCESS' || item === 'UNCLAIMED') && !tx.settled) {
    await db.settleFunds(tx.amount, true);
    patch.settled = true;
  }
  if (item === 'SUCCESS') reportPatch = { status: STATUS.PAID, statusReason: `$${tx.amount.toFixed(2)} delivered via PayPal.`, paidAt: new Date().toISOString() };
  if (item === 'UNCLAIMED') reportPatch = { status: STATUS.PAYOUT_UNCLAIMED, statusReason: 'Sent — waiting for the recipient to claim it in PayPal.' };
  if (FAILED_ITEM_STATUSES.includes(item)) {
    if (tx.settled) await db.reverseDisbursement(tx.amount);
    else await db.settleFunds(tx.amount, false);
    patch.settled = false;
    patch.released = true;
    reportPatch = { status: STATUS.PAYOUT_FAILED, statusReason: `PayPal reported ${item}. Funds returned to the pool.` };
  }

  const updatedTx = await db.updateTransaction(tx.id, patch);
  const report = reportPatch ? await db.updateReport(tx.reportId, reportPatch) : await db.getReport(tx.reportId);
  return { report, tx: updatedTx };
}

export async function refreshPayout(transactionId) {
  const tx = await db.getTransaction(transactionId);
  if (!tx || tx.type !== 'PAYOUT') throw Object.assign(new Error('Payout transaction not found'), { status: 404 });
  if (!tx.batchId) return { tx, report: await db.getReport(tx.reportId) };
  if (tx.released) return { tx, report: await db.getReport(tx.reportId) };
  const status = await getPayoutStatus(tx.batchId);
  return applyPayoutStatus(tx, status);
}

/** Refresh every payout still in flight (called by the dashboard and on a timer). */
export async function refreshPendingPayouts() {
  const txs = await db.listTransactions({ limit: 200 });
  const pending = txs.filter((t) => t.type === 'PAYOUT' && t.batchId && !t.released && ['PENDING', 'PROCESSING', 'ONHOLD', 'UNCLAIMED', 'CREATED'].includes(t.status));
  const results = [];
  for (const t of pending) {
    try {
      results.push(await refreshPayout(t.id));
    } catch (err) {
      console.error(`[payout] refresh ${t.id} failed:`, err.message);
    }
  }
  return results.length;
}

/** After a donation, release queued payouts — most vulnerable first. */
export async function processFundingQueue() {
  const queued = (await db.listReports({ where: ['status', '==', STATUS.AWAITING_FUNDS] })).sort(
    (a, b) => (b.ai?.vulnerability_score || 0) - (a.ai?.vulnerability_score || 0) || a.createdAt.localeCompare(b.createdAt),
  );
  const released = [];
  for (const r of queued) {
    const pool = await db.getPool();
    if (pool.available < r.ai.recommended_amount_usd) continue; // a smaller request further down may still fit
    const result = await disburse(r.id, { trigger: 'funding_queue' });
    if (result.transaction) released.push(r.id);
  }
  return released;
}
