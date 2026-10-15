import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { config } from '../config.js';
import { db } from '../services/firebaseService.js';
import { scoreReport, buildBriefing, detectFraudSignals } from '../services/aiService.js';
import { validateReport } from './reports.js';
import { requireAdmin } from '../middleware/auth.js';

const router = Router();
const aiLimiter = rateLimit({ windowMs: 60_000, limit: 15, standardHeaders: 'draft-8', legacyHeaders: false });

router.get('/status', (_req, res) => {
  res.json({ provider: config.openai.enabled ? 'openai' : 'heuristic', model: config.openai.enabled ? config.openai.model : 'heuristic-v1' });
});

/**
 * POST /api/ai/score — dry-run triage. Scores a report without saving it or paying out.
 * Useful for coordinators, testing prompts, and the Postman collection.
 */
router.post('/score', aiLimiter, async (req, res, next) => {
  try {
    const { errors, value, photo } = validateReport({ recipientEmail: 'dry-run@reliefchain.local', name: 'Dry Run', ...req.body });
    if (Object.keys(errors).length) return res.status(400).json({ error: 'Invalid report', fields: errors });
    const existing = await db.listReports({ limit: 1000 });
    const signals = detectFraudSignals({ ...value, clientIp: null }, req.body.recipientEmail ? existing : []);
    const triage = await scoreReport({ ...value, photo }, signals.context);
    res.json({ ...triage, fraud_flags: [...new Set([...signals.flags, ...triage.fraud_flags])], threshold: config.relief.payoutThreshold });
  } catch (err) {
    next(err);
  }
});

/** POST /api/ai/briefing — AI situation summary for coordinators. */
router.post('/briefing', requireAdmin, aiLimiter, async (_req, res, next) => {
  try {
    const [reports, pool] = await Promise.all([db.listReports({ limit: 300 }), db.getPool()]);
    res.json(await buildBriefing(reports.filter((r) => r.status !== 'REJECTED'), pool));
  } catch (err) {
    next(err);
  }
});

export default router;
