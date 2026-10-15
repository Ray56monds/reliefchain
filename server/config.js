import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Root .env first (documented in .env.example), then server/.env as an override.
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '.env'), override: true });

const env = process.env;

const num = (value, fallback) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

export const config = {
  port: num(env.PORT, 3001),
  nodeEnv: env.NODE_ENV || 'development',
  corsOrigin: env.CORS_ORIGIN || '*',
  adminApiKey: env.ADMIN_API_KEY || 'reliefchain-demo-admin',

  paypal: {
    clientId: env.PAYPAL_CLIENT_ID || '',
    clientSecret: env.PAYPAL_CLIENT_SECRET || '',
    mode: env.PAYPAL_MODE === 'live' ? 'live' : 'sandbox',
    get enabled() {
      return Boolean(this.clientId && this.clientSecret);
    },
    get baseUrl() {
      return this.mode === 'live' ? 'https://api-m.paypal.com' : 'https://api-m.sandbox.paypal.com';
    },
  },

  openai: {
    apiKey: env.OPENAI_API_KEY || '',
    model: env.OPENAI_MODEL || 'gpt-4o',
    get enabled() {
      return Boolean(this.apiKey);
    },
  },

  firebase: {
    projectId: env.FIREBASE_PROJECT_ID || '',
    clientEmail: env.FIREBASE_CLIENT_EMAIL || '',
    // Render / .env files store the key with literal "\n" sequences.
    privateKey: (env.FIREBASE_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
    get enabled() {
      return Boolean(this.projectId && this.clientEmail && this.privateKey);
    },
  },

  relief: {
    // A payout is only released when the AI score is strictly above this.
    payoutThreshold: num(env.PAYOUT_SCORE_THRESHOLD, 70),
    minPayoutUsd: num(env.MIN_PAYOUT_USD, 10),
    maxPayoutUsd: num(env.MAX_PAYOUT_USD, 150),
    // Seed the pool in local demo mode so payouts can be shown before any donation.
    demoSeedPoolUsd: num(env.DEMO_SEED_POOL_USD, 500),
  },

  dataDir: path.resolve(__dirname, '.data'),
  clientDist: path.resolve(__dirname, '../client/dist'),
};
