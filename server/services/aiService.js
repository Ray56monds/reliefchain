import OpenAI from 'openai';
import { config } from '../config.js';
import { findNeighbourhood } from '../data/neighbourhoods.js';

const PRIORITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'];
export const KNOWN_FRAUD_FLAGS = [
  'duplicate_location',
  'duplicate_recipient',
  'duplicate_household',
  'suspicious_timing',
  'inconsistent_details',
  'implausible_household',
  'photo_mismatch',
  'low_detail_report',
];

let client = null;
const openai = () => (client ||= new OpenAI({ apiKey: config.openai.apiKey }));

// Strict JSON schema so GPT-4o can only return a well-formed triage object.
const TRIAGE_SCHEMA = {
  name: 'vulnerability_triage',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: [
      'vulnerability_score',
      'priority',
      'recommended_amount_usd',
      'reasoning',
      'fraud_flags',
      'needs',
      'photo_assessment',
    ],
    properties: {
      vulnerability_score: { type: 'integer', description: '0-100, higher = more urgent need' },
      priority: { type: 'string', enum: PRIORITIES },
      recommended_amount_usd: { type: 'number', description: 'Emergency cash in USD, 10-150' },
      reasoning: { type: 'string', description: 'One sentence explanation' },
      fraud_flags: { type: 'array', items: { type: 'string', enum: KNOWN_FRAUD_FLAGS } },
      needs: {
        type: 'array',
        description: 'Most urgent needs, e.g. shelter, food, clean_water, medical, transport',
        items: { type: 'string' },
      },
      photo_assessment: {
        type: 'string',
        description: 'One sentence on whether the photo corroborates the report, or "no photo provided"',
      },
    },
  },
};

const SYSTEM_PROMPT = `You are a disaster relief triage AI for Kampala, Uganda.
You score how urgently a household needs emergency cash after a flood or disaster, so that a limited relief pool reaches the most vulnerable first.

Scoring guidance:
- 85-100 CRITICAL: life/safety at risk — home destroyed or uninhabitable, injuries, infants/elderly/disabled members without shelter, no food or water.
- 70-84 HIGH: significant losses — water inside the home, belongings/food stock destroyed, livelihood lost, vulnerable members present.
- 40-69 MEDIUM: moderate damage, household coping but stressed.
- 0-39 LOW: minor inconvenience or unclear impact.
Weigh household size, vulnerable members and the neighbourhood's flood risk. Informal settlements in Bwaise, Kinawataka and Nakivubo flood repeatedly and have little resilience.
recommended_amount_usd: 10-150 USD, scaled to household size and severity (roughly 2-3 days of food, water and temporary shelter per person).

Fraud screening (only flag with a concrete reason — false flags delay real aid):
- inconsistent_details: description contradicts household size / members / neighbourhood.
- implausible_household: e.g. 30 people, or vulnerable counts exceeding household size.
- low_detail_report: generic copy-paste text with no specifics of the damage.
- photo_mismatch: photo clearly unrelated to flooding / damage (stock image, selfie, document).
- suspicious_timing / duplicate_*: only if the context section indicates it.
Return an empty fraud_flags array when nothing is suspicious.`;

const riskLevel = (neighbourhood) => findNeighbourhood(neighbourhood)?.risk || 'MEDIUM';

const describeVulnerable = (v = {}) => {
  const parts = Object.entries(v)
    .filter(([, n]) => Number(n) > 0)
    .map(([k, n]) => `${n} ${k.replace('_', ' ')}`);
  return parts.length ? parts.join(', ') : 'none reported';
};

function buildUserPrompt(report, context = {}) {
  return `Analyse this disaster report and return a JSON vulnerability score.

Report: ${report.description}
Household size: ${report.householdSize}
Vulnerable members: ${describeVulnerable(report.vulnerableMembers)}
Neighbourhood: ${report.neighbourhood}
Neighbourhood flood risk: ${riskLevel(report.neighbourhood)} (Bwaise=HIGH, Kinawataka=HIGH, Nakivubo=HIGH, others=MEDIUM)
Disaster type: ${report.disasterType || 'flood'}

Context from ReliefChain records:
- Reports from this neighbourhood in the last hour: ${context.recentInNeighbourhood ?? 0}
- Previous reports with the same payout email: ${context.sameRecipientCount ?? 0}
- Previous reports with the same name in this neighbourhood: ${context.sameHouseholdCount ?? 0}
- Photo attached: ${report.photo ? 'yes (see image)' : 'no'}`;
}

/** Clamp and normalise whatever the model returns so downstream gating is safe. */
export function sanitiseTriage(raw, source) {
  let score = Math.round(Number(raw?.vulnerability_score));
  if (!Number.isFinite(score)) score = 0;
  score = Math.max(0, Math.min(100, score));

  const priority = PRIORITIES.includes(raw?.priority) ? raw.priority : priorityFromScore(score);

  let amount = Number(raw?.recommended_amount_usd);
  if (!Number.isFinite(amount)) amount = 0;
  amount = Math.max(config.relief.minPayoutUsd, Math.min(config.relief.maxPayoutUsd, amount));
  amount = Math.round(amount * 100) / 100;

  const fraud_flags = [...new Set((raw?.fraud_flags || []).map((f) => String(f).toLowerCase().trim()).filter(Boolean))];

  return {
    vulnerability_score: score,
    priority,
    recommended_amount_usd: amount,
    reasoning: String(raw?.reasoning || '').slice(0, 400),
    fraud_flags,
    needs: (raw?.needs || []).map(String).slice(0, 6),
    photo_assessment: String(raw?.photo_assessment || 'no photo provided').slice(0, 300),
    source,
    model: source === 'openai' ? config.openai.model : 'heuristic-v1',
    scoredAt: new Date().toISOString(),
  };
}

export function priorityFromScore(score) {
  if (score >= 85) return 'CRITICAL';
  if (score >= 70) return 'HIGH';
  if (score >= 40) return 'MEDIUM';
  return 'LOW';
}

/**
 * Score a report's vulnerability with GPT-4o (text + optional photo via vision).
 * Falls back to a transparent heuristic when no API key is set or the API fails.
 */
export async function scoreReport(report, context = {}) {
  if (!config.openai.enabled) return heuristicScore(report, context);

  const userContent = [{ type: 'text', text: buildUserPrompt(report, context) }];
  if (report.photo && /^data:image\//.test(report.photo)) {
    userContent.push({ type: 'image_url', image_url: { url: report.photo, detail: 'low' } });
  }

  try {
    const completion = await openai().chat.completions.create({
      model: config.openai.model,
      temperature: 0.2,
      response_format: { type: 'json_schema', json_schema: TRIAGE_SCHEMA },
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userContent },
      ],
    });
    const message = completion.choices[0]?.message;
    if (message?.refusal) throw new Error(`model refused: ${message.refusal}`);
    return sanitiseTriage(JSON.parse(message?.content || '{}'), 'openai');
  } catch (err) {
    console.error('[ai] OpenAI scoring failed, using heuristic fallback:', err.message);
    return { ...heuristicScore(report, context), fallbackReason: err.message };
  }
}

// ---------------------------------------------------------------------------
// Heuristic fallback — deterministic, explainable, used without an API key.
// ---------------------------------------------------------------------------
const SEVERITY_TERMS = [
  [/(swept|collapsed|destroyed|washed away|roof (fell|gone)|house fell)/i, 22],
  [/(injur|hospital|sick|cholera|fever|bleeding|drown)/i, 18],
  [/(no food|hungry|nothing to eat|no water|no clean water)/i, 14],
  [/(water (inside|entered|in the house)|flooded (house|home)|knee|waist|chest)/i, 12],
  [/(sleeping outside|no shelter|nowhere to sleep|displaced|homeless)/i, 16],
  [/(lost (everything|stock|business|goods|livelihood)|shop|market stall)/i, 8],
];

export function heuristicScore(report, context = {}) {
  const v = report.vulnerableMembers || {};
  const vulnerableCount = Object.values(v).reduce((s, n) => s + (Number(n) || 0), 0);
  const size = Number(report.householdSize) || 1;
  const text = String(report.description || '');

  let score = 15;
  score += riskLevel(report.neighbourhood) === 'HIGH' ? 15 : 7;
  score += Math.min(12, size * 1.5);
  score += Math.min(20, vulnerableCount * 5);
  for (const [re, pts] of SEVERITY_TERMS) if (re.test(text)) score += pts;
  if (text.length < 40) score -= 10;

  const fraud_flags = [];
  // Categories overlap (an elderly person may also be chronically ill), so allow some slack.
  if (vulnerableCount > size * 1.5) fraud_flags.push('inconsistent_details');
  if (size > 25) fraud_flags.push('implausible_household');
  if (text.trim().length < 25) fraud_flags.push('low_detail_report');

  score = Math.max(0, Math.min(100, Math.round(score)));
  const amount = Math.min(config.relief.maxPayoutUsd, 10 + size * 8 + vulnerableCount * 5 + (score >= 85 ? 25 : 0));

  return sanitiseTriage(
    {
      vulnerability_score: score,
      priority: priorityFromScore(score),
      recommended_amount_usd: amount,
      reasoning: `Heuristic triage: ${riskLevel(report.neighbourhood)}-risk area, household of ${size} with ${vulnerableCount} vulnerable member(s)${
        score >= 70 ? ' and severe damage described' : ''
      }.`,
      fraud_flags,
      needs: inferNeeds(text),
      photo_assessment: report.photo ? 'Photo attached (not analysed in heuristic mode).' : 'no photo provided',
    },
    'heuristic',
  );
}

function inferNeeds(text) {
  const needs = [];
  if (/(shelter|roof|sleep|house|home)/i.test(text)) needs.push('shelter');
  if (/(food|eat|hungry)/i.test(text)) needs.push('food');
  if (/(water|drink)/i.test(text)) needs.push('clean_water');
  if (/(sick|injur|hospital|medic)/i.test(text)) needs.push('medical');
  return needs.length ? needs : ['cash_support'];
}

// ---------------------------------------------------------------------------
// Deterministic fraud signals from ReliefChain's own records.
// These are authoritative: the model cannot "un-flag" them.
// ---------------------------------------------------------------------------
const DUPLICATE_WINDOW_DAYS = 14;
const BURST_WINDOW_MIN = 60;
const BURST_LIMIT = 8;
const SAME_DEVICE_LIMIT = 6; // per 10 minutes

export function detectFraudSignals(report, existingReports) {
  const now = Date.now();
  const since = (days) => now - days * 86400_000;
  const active = existingReports.filter((r) => r.status !== 'REJECTED');
  const recent = active.filter((r) => Date.parse(r.createdAt) >= since(DUPLICATE_WINDOW_DAYS));

  const email = report.recipientEmail.toLowerCase();
  const nameKey = normaliseName(report.name);

  const sameRecipient = recent.filter((r) => r.recipientEmail?.toLowerCase() === email);
  const sameHousehold = recent.filter((r) => r.nameKey === nameKey && r.neighbourhood === report.neighbourhood);
  const recentInNeighbourhood = active.filter(
    (r) => r.neighbourhood === report.neighbourhood && Date.parse(r.createdAt) >= now - BURST_WINDOW_MIN * 60_000,
  );
  const sameIpRecent = report.clientIp
    ? active.filter((r) => r.clientIp === report.clientIp && Date.parse(r.createdAt) >= now - 10 * 60_000)
    : [];

  const flags = [];
  if (sameRecipient.length) flags.push('duplicate_recipient');
  if (sameHousehold.length) flags.push('duplicate_household');
  // One volunteer's phone often files for several households, so same-device
  // submissions are only suspicious in bulk.
  if (sameIpRecent.length >= SAME_DEVICE_LIMIT) flags.push('suspicious_timing');
  if (recentInNeighbourhood.length >= BURST_LIMIT && sameIpRecent.length >= SAME_DEVICE_LIMIT / 2) flags.push('duplicate_location');

  return {
    flags,
    context: {
      recentInNeighbourhood: recentInNeighbourhood.length,
      sameRecipientCount: sameRecipient.length,
      sameHouseholdCount: sameHousehold.length,
    },
  };
}

export const normaliseName = (name) =>
  String(name || '')
    .toLowerCase()
    .replace(/[^a-z\s]/g, '')
    .split(/\s+/)
    .filter(Boolean)
    .sort()
    .join(' ');

// ---------------------------------------------------------------------------
// Coordinator briefing — AI summary of the current situation for the dashboard.
// ---------------------------------------------------------------------------
const BRIEFING_SCHEMA = {
  name: 'coordinator_briefing',
  strict: true,
  schema: {
    type: 'object',
    additionalProperties: false,
    required: ['headline', 'hotspots', 'recommendations', 'risks'],
    properties: {
      headline: { type: 'string' },
      hotspots: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['neighbourhood', 'summary'],
          properties: { neighbourhood: { type: 'string' }, summary: { type: 'string' } },
        },
      },
      recommendations: { type: 'array', items: { type: 'string' } },
      risks: { type: 'array', items: { type: 'string' } },
    },
  },
};

export async function buildBriefing(reports, pool) {
  const byHood = {};
  for (const r of reports) {
    const h = (byHood[r.neighbourhood] ||= { reports: 0, critical: 0, flagged: 0, people: 0, needs: {} });
    h.reports += 1;
    h.people += Number(r.householdSize) || 0;
    if (r.ai?.priority === 'CRITICAL') h.critical += 1;
    if (r.status === 'FLAGGED') h.flagged += 1;
    for (const n of r.ai?.needs || []) h.needs[n] = (h.needs[n] || 0) + 1;
  }
  const stats = { totalReports: reports.length, pool, neighbourhoods: byHood };

  if (!config.openai.enabled || !reports.length) return heuristicBriefing(stats);

  try {
    const completion = await openai().chat.completions.create({
      model: config.openai.model,
      temperature: 0.3,
      response_format: { type: 'json_schema', json_schema: BRIEFING_SCHEMA },
      messages: [
        {
          role: 'system',
          content:
            'You are the operations analyst for ReliefChain, a disaster cash-relief programme in Kampala, Uganda. Write a concise, actionable briefing for relief coordinators. Be specific to neighbourhoods and numbers. Max 4 items per list.',
        },
        {
          role: 'user',
          content: `Current situation data (JSON):\n${JSON.stringify(stats)}\n\nRecent report excerpts:\n${reports
            .slice(0, 25)
            .map((r) => `- [${r.neighbourhood}, ${r.ai?.priority}, score ${r.ai?.vulnerability_score}] ${String(r.description).slice(0, 160)}`)
            .join('\n')}`,
        },
      ],
    });
    return { ...JSON.parse(completion.choices[0].message.content), source: 'openai', generatedAt: new Date().toISOString() };
  } catch (err) {
    console.error('[ai] briefing failed, using heuristic:', err.message);
    return heuristicBriefing(stats);
  }
}

function heuristicBriefing({ totalReports, pool, neighbourhoods }) {
  const ranked = Object.entries(neighbourhoods).sort((a, b) => b[1].critical - a[1].critical || b[1].reports - a[1].reports);
  const flagged = ranked.reduce((s, [, h]) => s + h.flagged, 0);
  return {
    headline: totalReports
      ? `${totalReports} report(s) across ${ranked.length} neighbourhood(s); $${pool.available.toFixed(2)} available in the relief pool.`
      : 'No reports yet — the relief pool is standing by.',
    hotspots: ranked.slice(0, 3).map(([name, h]) => ({
      neighbourhood: name,
      summary: `${h.reports} report(s), ${h.critical} critical, ~${h.people} people affected. Top needs: ${
        Object.keys(h.needs).slice(0, 3).join(', ') || 'n/a'
      }.`,
    })),
    recommendations: [
      flagged ? `Review ${flagged} flagged report(s) so genuine households are not delayed.` : 'No reports awaiting fraud review.',
      pool.available < 100 ? 'Relief pool is running low — push the donation link to partners.' : 'Pool balance is healthy for the next payouts.',
    ],
    risks: ranked.filter(([n]) => findNeighbourhood(n)?.risk === 'HIGH').map(([n]) => `${n} is a high flood-risk zone; expect further reports if rain continues.`),
    source: 'heuristic',
    generatedAt: new Date().toISOString(),
  };
}
