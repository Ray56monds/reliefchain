import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { db } from '../services/firebaseService.js';
import { scoreReport, detectFraudSignals, normaliseName } from '../services/aiService.js';
import { disburse, evaluateGate, STATUS } from '../services/disbursementService.js';
import { NEIGHBOURHOODS, findNeighbourhood, VULNERABLE_GROUPS } from '../data/neighbourhoods.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();

const submitLimiter = rateLimit({ windowMs: 10 * 60_000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const MAX_PHOTO_CHARS = 1_500_000; // ~1.1 MB image as a data URL

export function validateReport(body) {
  const errors = {};
  const name = String(body.name || '').trim();
  const description = String(body.description || '').trim();
  const recipientEmail = String(body.recipientEmail || '').trim().toLowerCase();
  const householdSize = Number.parseInt(body.householdSize, 10);
  const hood = findNeighbourhood(body.neighbourhood);

  if (name.length < 2 || name.length > 80) errors.name = 'Enter the name of the head of household.';
  if (!hood) errors.neighbourhood = 'Choose a Kampala neighbourhood from the list.';
  if (description.length < 10 || description.length > 2000) errors.description = 'Describe what happened (10–2000 characters).';
  if (!Number.isInteger(householdSize) || householdSize < 1 || householdSize > 50) errors.householdSize = 'Household size must be 1–50.';
  if (!EMAIL_RE.test(recipientEmail)) errors.recipientEmail = 'Enter a valid PayPal email to receive funds.';

  const vulnerableMembers = {};
  for (const g of VULNERABLE_GROUPS) {
    const n = Number.parseInt(body.vulnerableMembers?.[g] ?? 0, 10);
    if (!Number.isInteger(n) || n < 0 || n > 50) errors[`vulnerableMembers.${g}`] = 'Must be 0–50.';
    else vulnerableMembers[g] = n;
  }

  let photo = null;
  if (body.photo) {
    if (typeof body.photo !== 'string' || !/^data:image\/(jpeg|png|webp);base64,/.test(body.photo)) errors.photo = 'Photo must be a JPEG, PNG or WebP image.';
    else if (body.photo.length > MAX_PHOTO_CHARS) errors.photo = 'Photo is too large — please use a smaller image.';
    else photo = body.photo;
  }

  return {
    errors,
    value: {
      name,
      nameKey: normaliseName(name),
      neighbourhood: hood?.name,
      description,
      householdSize,
      vulnerableMembers,
      recipientEmail,
      phone: String(body.phone || '').trim().slice(0, 20) || null,
      disasterType: ['flood', 'fire', 'landslide', 'storm', 'other'].includes(body.disasterType) ? body.disasterType : 'flood',
    },
    photo,
  };
}

/** Public-safe projection: no names, emails, phones or IPs. */
export const publicReport = (r) => ({
  id: r.id,
  neighbourhood: r.neighbourhood,
  disasterType: r.disasterType,
  householdSize: r.householdSize,
  score: r.ai?.vulnerability_score,
  priority: r.ai?.priority,
  status: r.status,
  createdAt: r.createdAt,
});

/** What the person who submitted the report sees. */
const submitterView = (r) => ({
  ...publicReport(r),
  ai: r.ai && {
    vulnerability_score: r.ai.vulnerability_score,
    priority: r.ai.priority,
    recommended_amount_usd: r.ai.recommended_amount_usd,
    reasoning: r.ai.reasoning,
    needs: r.ai.needs,
    source: r.ai.source,
  },
  statusReason: r.status === STATUS.FLAGGED ? 'Your report is being reviewed by a ReliefChain coordinator.' : r.statusReason,
});

router.get('/neighbourhoods', (_req, res) => res.json(NEIGHBOURHOODS));

/**
 * POST /api/reports — submit → fraud signals → AI triage → save → gated PayPal payout.
 */
router.post('/', submitLimiter, async (req, res, next) => {
  try {
    const { errors, value, photo } = validateReport(req.body || {});
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Please fix the highlighted fields.', fields: errors });

    const clientIp = req.ip;
    const existing = await db.listReports({ limit: 1000 });
    const signals = detectFraudSignals({ ...value, clientIp }, existing);

    const ai = await scoreReport({ ...value, photo }, signals.context);
    const fraudFlags = [...new Set([...signals.flags, ...ai.fraud_flags])];

    let report = await db.createReport(
      {
        ...value,
        clientIp,
        ai,
        fraudFlags,
        fraudSources: { system: signals.flags, ai: ai.fraud_flags },
        status: 'SCORED',
        payoutAttempts: 0,
      },
      photo,
    );

    const result = await disburse(report.id, { trigger: 'auto' });
    report = result.report;

    res.status(201).json({
      report: submitterView(report),
      payout: result.transaction
        ? { status: result.transaction.status, amount: result.transaction.amount, simulated: result.transaction.simulated }
        : null,
    });
  } catch (err) {
    next(err);
  }
});

/** Public, anonymised feed for the live map and home page. */
router.get('/public', async (_req, res, next) => {
  try {
    const reports = await db.listReports({ limit: 500 });
    res.json(reports.filter((r) => r.status !== STATUS.REJECTED).map(publicReport));
  } catch (err) {
    next(err);
  }
});

/** Status check for a submitter who kept their report id. */
router.get('/:id/status', async (req, res, next) => {
  try {
    const r = await db.getReport(req.params.id);
    if (!r) return res.status(404).json({ error: 'Report not found' });
    res.json(submitterView(r));
  } catch (err) {
    next(err);
  }
});

// ----- Coordinator-only below -----

router.get('/', requireAdmin, async (_req, res, next) => {
  try {
    const reports = await db.listReports({ limit: 1000 });
    res.json(reports.map(({ clientIp, nameKey, ...r }) => ({ ...r, gate: evaluateGate(r) })));
  } catch (err) {
    next(err);
  }
});

router.get('/:id/photo', requireAdmin, async (req, res, next) => {
  try {
    const dataUrl = await db.getReportPhoto(req.params.id);
    if (!dataUrl) return res.status(404).json({ error: 'No photo for this report' });
    res.json({ dataUrl });
  } catch (err) {
    next(err);
  }
});

/**
 * POST /api/reports/:id/review { action: "approve" | "reject", note }
 * approve: coordinator verified the household → clears flags and re-runs the payout gate.
 * reject: report is closed and will never be paid.
 */
router.post('/:id/review', requireAdmin, async (req, res, next) => {
  try {
    const { action, note = '' } = req.body || {};
    const report = await db.getReport(req.params.id);
    if (!report) return res.status(404).json({ error: 'Report not found' });
    if (![STATUS.FLAGGED, STATUS.BELOW_THRESHOLD, STATUS.AWAITING_FUNDS, STATUS.PAYOUT_FAILED].includes(report.status)) {
      return res.status(409).json({ error: `Report in status ${report.status} cannot be reviewed.` });
    }
    const review = { action, note: String(note).slice(0, 500), by: req.actor, at: new Date().toISOString(), previousFlags: report.fraudFlags };

    if (action === 'reject') {
      const updated = await db.updateReport(report.id, { status: STATUS.REJECTED, statusReason: `Rejected by coordinator${note ? `: ${note}` : '.'}`, review });
      return res.json({ report: updated });
    }
    if (action !== 'approve') return res.status(400).json({ error: 'action must be "approve" or "reject"' });

    // Re-open the report so the gate re-evaluates it: flags cleared, status reset.
    await db.updateReport(report.id, { fraudFlags: [], status: 'SCORED', review });
    const result = await disburse(report.id, { trigger: 'coordinator_review', actor: req.actor });
    res.json(result);
  } catch (err) {
    next(err);
  }
});

export default router;
