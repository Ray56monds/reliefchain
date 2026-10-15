import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { db } from './services/firebaseService.js';
import { refreshPendingPayouts } from './services/disbursementService.js';
import reportsRouter from './routes/reports.js';
import paypalRouter from './routes/paypal.js';
import aiRouter from './routes/ai.js';

const app = express();

app.set('trust proxy', 1); // Render sits behind a proxy; needed for correct client IPs / rate limits
app.disable('x-powered-by');
app.use(
  cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(',').map((o) => o.trim()),
  }),
);
app.use(express.json({ limit: '3mb' })); // photo data URLs

app.get('/api/health', async (_req, res) => {
  res.json({
    status: 'ok',
    service: 'reliefchain-api',
    time: new Date().toISOString(),
    integrations: {
      database: await db.backendName(),
      ai: config.openai.enabled ? `openai:${config.openai.model}` : 'heuristic',
      paypal: config.paypal.enabled ? config.paypal.mode : 'simulated',
    },
  });
});

app.use('/api/reports', reportsRouter);
app.use('/api/paypal', paypalRouter);
app.use('/api/ai', aiRouter);

app.use('/api', (_req, res) => res.status(404).json({ error: 'Not found' }));

// Single-service deploys: serve the built React app if present.
if (fs.existsSync(config.clientDist)) {
  app.use(express.static(config.clientDist));
  app.get(/^(?!\/api).*/, (_req, res) => res.sendFile(path.join(config.clientDist, 'index.html')));
}

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  const status = err.status && err.status >= 400 && err.status < 600 ? err.status : 500;
  if (status >= 500) console.error('[error]', err);
  res.status(status).json({
    error: status >= 500 && err.name !== 'PayPalError' ? 'Something went wrong. Please try again.' : err.message,
    ...(err.debugId && { paypalDebugId: err.debugId }),
  });
});

app.listen(config.port, () => {
  console.log(`ReliefChain API listening on http://localhost:${config.port}`);
  console.log(`[paypal] ${config.paypal.enabled ? `${config.paypal.mode} mode` : 'not configured — payouts and donations are SIMULATED'}`);
  console.log(`[ai] ${config.openai.enabled ? `OpenAI ${config.openai.model}` : 'no OPENAI_API_KEY — heuristic triage'}`);
  db.backendName(); // initialise + log the database backend
});

// PayPal payouts settle asynchronously — poll in-flight batches every 2 minutes.
setInterval(() => refreshPendingPayouts().catch((e) => console.error('[payout] poll failed:', e.message)), 120_000).unref();
