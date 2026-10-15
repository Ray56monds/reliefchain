#!/usr/bin/env node
/**
 * Seed realistic demo reports through the real API (validation → fraud checks → AI → payout gate).
 * Usage: npm run seed            (server must be running; defaults to http://localhost:3001)
 *        API_URL=https://… npm run seed
 */
import '../config.js'; // loads .env

const API = (process.env.API_URL || `http://localhost:${process.env.PORT || 3001}`).replace(/\/$/, '');
const RECIPIENT = process.env.VITE_DEMO_RECIPIENT_EMAIL || process.env.DEMO_RECIPIENT_EMAIL;

// Sandbox payouts must go to sandbox accounts; plus-addressing keeps each household's email unique.
// Seeded households never use the exact sandbox email, so the first report you submit
// live in the UI with that email passes the duplicate check and pays out as SUCCESS.
const email = (tag) => {
  if (!RECIPIENT) return `${tag}@example.com`;
  const [user, domain] = RECIPIENT.split('@');
  return domain.endsWith('example.com') ? `${tag}.${user}@${domain}` : `${user}+${tag}@${domain}`;
};

const REPORTS = [
  {
    name: 'Nalwoga Sarah',
    neighbourhood: 'Bwaise',
    description:
      'The Nsooba channel burst at 2am and water came into our house up to the waist. The mud wall at the back collapsed. All our food and mattresses are destroyed and my mother (72) and my four children are sleeping at the church. My youngest has a fever.',
    householdSize: 7,
    vulnerableMembers: { elderly: 1, children: 3, chronically_ill: 0 },
    tag: 'nalwoga',
  },
  {
    name: 'Ssemakula Joseph',
    neighbourhood: 'Kinawataka',
    description:
      'Flood water entered the house knee deep for the second time this month. We lost the stock of my charcoal business and the pit latrine overflowed into the compound. My wife is pregnant and we have no clean water.',
    householdSize: 5,
    vulnerableMembers: { pregnant: 1, children: 2 },
    tag: 'ssemakula',
  },
  {
    name: 'Akello Grace',
    neighbourhood: 'Nakivubo',
    description:
      'Our room near the channel was washed away. My son who uses a wheelchair was injured getting out and was taken to Mulago hospital. We are displaced with nothing — no food, no shelter, no clothes.',
    householdSize: 4,
    vulnerableMembers: { disabled: 1, children: 1 },
    tag: 'akello',
  },
  {
    name: 'Mugisha Robert',
    neighbourhood: 'Kawempe',
    description: 'Heavy rain flooded the road and some water came under the door. The floor is wet and a few items got damaged but the family is okay.',
    householdSize: 3,
    vulnerableMembers: {},
    tag: 'mugisha',
  },
  {
    name: 'Namubiru Aisha',
    neighbourhood: 'Makindye',
    description:
      'Rainwater flooded the kitchen and the stored maize and beans got soaked and spoilt. The roof is leaking badly over where the children sleep. My grandmother lives with us and is diabetic.',
    householdSize: 6,
    vulnerableMembers: { elderly: 1, chronically_ill: 1, children: 2 },
    tag: 'namubiru',
  },
  {
    name: 'Okello Peter',
    neighbourhood: 'Rubaga',
    description: 'Some water in the compound after the storm, minor mess.',
    householdSize: 2,
    vulnerableMembers: {},
    tag: 'okello',
  },
  {
    // Deliberate duplicate (same payout email + same household) — exercises fraud screening.
    name: 'Sarah Nalwoga',
    neighbourhood: 'Bwaise',
    description: 'Water came into the house and destroyed our food and mattresses. My mother and children have no place to sleep.',
    householdSize: 7,
    vulnerableMembers: { elderly: 1, children: 3 },
    tag: 'nalwoga',
  },
];

async function main() {
  const health = await fetch(`${API}/api/health`).then((r) => r.json()).catch(() => null);
  if (!health) {
    console.error(`Cannot reach ${API}. Start the server first (npm run dev).`);
    process.exit(1);
  }
  console.log(`Seeding ${REPORTS.length} reports → ${API}  (ai: ${health.integrations.ai}, paypal: ${health.integrations.paypal})\n`);

  for (const { tag, ...r } of REPORTS) {
    const res = await fetch(`${API}/api/reports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...r, recipientEmail: email(tag), disasterType: 'flood' }),
    });
    const body = await res.json();
    if (!res.ok) {
      console.log(`✗ ${r.name}: ${body.error}`);
      continue;
    }
    const { report, payout } = body;
    console.log(
      `${report.priority.padEnd(8)} ${String(report.score).padStart(3)}  ${r.neighbourhood.padEnd(11)} ${report.status.padEnd(16)} ${
        payout ? `$${payout.amount} ${payout.status}` : ''
      }`,
    );
  }
}

main();
