import crypto from 'node:crypto';
import { config } from '../config.js';

/**
 * Thin wrapper over the PayPal REST API (no SDK — every call is explicit):
 *   - OAuth 2.0 client-credentials token, cached until shortly before expiry
 *   - Orders v2 (donations): create + capture
 *   - Payouts v1 (disbursements): create batch + poll batch status
 *
 * When PAYPAL_CLIENT_ID / SECRET are not set, calls are simulated and every
 * result is marked `simulated: true` so the UI can label it honestly.
 */

export class PayPalError extends Error {
  constructor(message, { status, details, debugId } = {}) {
    super(message);
    this.name = 'PayPalError';
    this.status = status;
    this.details = details;
    this.debugId = debugId;
  }
}

let cachedToken = null; // { value, expiresAt }

export async function getAccessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;

  const basic = Buffer.from(`${config.paypal.clientId}:${config.paypal.clientSecret}`).toString('base64');
  const res = await fetch(`${config.paypal.baseUrl}/v1/oauth2/token`, {
    method: 'POST',
    headers: { Authorization: `Basic ${basic}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: 'grant_type=client_credentials',
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new PayPalError(`PayPal auth failed: ${body.error_description || res.statusText}`, { status: res.status, details: body });
  }
  cachedToken = { value: body.access_token, expiresAt: Date.now() + body.expires_in * 1000 };
  return cachedToken.value;
}

async function paypalFetch(path, { method = 'GET', body, idempotencyKey } = {}) {
  const token = await getAccessToken();
  const headers = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };
  // PayPal-Request-Id makes retries safe: PayPal returns the original result instead of acting twice.
  if (idempotencyKey) headers['PayPal-Request-Id'] = idempotencyKey;

  const res = await fetch(`${config.paypal.baseUrl}${path}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const detail = data.details?.[0]?.description || data.details?.[0]?.issue;
    throw new PayPalError(`PayPal ${method} ${path} failed: ${data.message || data.name || res.statusText}${detail ? ` — ${detail}` : ''}`, {
      status: res.status,
      details: data,
      debugId: data.debug_id || res.headers.get('paypal-debug-id'),
    });
  }
  return data;
}

const money = (n) => (Math.round(Number(n) * 100) / 100).toFixed(2);
const simId = (prefix) => `SIM-${prefix}-${crypto.randomBytes(5).toString('hex').toUpperCase()}`;

// ---------------------------------------------------------------------------
// Orders v2 — donor checkout
// ---------------------------------------------------------------------------
export async function createOrder(amount) {
  if (!config.paypal.enabled) return { id: simId('ORDER'), status: 'CREATED', simulated: true };

  return paypalFetch('/v2/checkout/orders', {
    method: 'POST',
    idempotencyKey: `rc-order-${crypto.randomUUID()}`,
    body: {
      intent: 'CAPTURE',
      purchase_units: [
        {
          reference_id: 'reliefchain_pool',
          description: 'ReliefChain disaster relief fund — Kampala, Uganda',
          soft_descriptor: 'RELIEFCHAIN',
          amount: { currency_code: 'USD', value: money(amount) },
        },
      ],
      payment_source: {
        paypal: {
          experience_context: {
            brand_name: 'ReliefChain',
            shipping_preference: 'NO_SHIPPING',
            user_action: 'PAY_NOW',
          },
        },
      },
    },
  });
}

/**
 * Capture an approved order. Returns a normalised result with the amount PayPal
 * actually captured — the server never trusts an amount sent by the browser.
 */
export async function captureOrder(orderId, simulatedAmount) {
  if (!config.paypal.enabled || String(orderId).startsWith('SIM-')) {
    if (config.paypal.enabled) throw new PayPalError('Simulated orders are not accepted when PayPal is configured', { status: 400 });
    return {
      orderId,
      status: 'COMPLETED',
      captureId: simId('CAPTURE'),
      amount: Number(money(simulatedAmount)),
      currency: 'USD',
      payerEmail: 'demo-donor@reliefchain.local',
      payerName: 'Demo donor',
      simulated: true,
    };
  }

  const data = await paypalFetch(`/v2/checkout/orders/${encodeURIComponent(orderId)}/capture`, {
    method: 'POST',
    idempotencyKey: `rc-capture-${orderId}`,
  });
  const capture = data.purchase_units?.[0]?.payments?.captures?.[0];
  return {
    orderId: data.id,
    status: data.status, // COMPLETED when funds are captured
    captureId: capture?.id,
    captureStatus: capture?.status,
    amount: Number(capture?.amount?.value || 0),
    currency: capture?.amount?.currency_code || 'USD',
    payerEmail: data.payer?.email_address,
    payerName: [data.payer?.name?.given_name, data.payer?.name?.surname].filter(Boolean).join(' '),
    simulated: false,
  };
}

// ---------------------------------------------------------------------------
// Payouts v1 — disbursement to households
// ---------------------------------------------------------------------------
export async function createPayout({ reportId, amount, recipientEmail, neighbourhood }) {
  const senderBatchId = `reliefchain_${reportId}_${Date.now()}`;

  if (!config.paypal.enabled) {
    return {
      batchId: simId('BATCH'),
      senderBatchId,
      batchStatus: 'SUCCESS',
      itemStatus: 'SUCCESS',
      payoutItemId: simId('ITEM'),
      transactionId: simId('TXN'),
      simulated: true,
    };
  }

  const data = await paypalFetch('/v1/payments/payouts', {
    method: 'POST',
    // One payout per report, ever: retries with the same report id are de-duplicated by PayPal.
    idempotencyKey: `rc-payout-${reportId}`,
    body: {
      sender_batch_header: {
        sender_batch_id: senderBatchId,
        email_subject: 'ReliefChain Emergency Funds',
        email_message: 'Emergency relief funds from the ReliefChain community.',
      },
      items: [
        {
          recipient_type: 'EMAIL',
          amount: { value: money(amount), currency: 'USD' },
          receiver: recipientEmail,
          note: `Emergency relief — ${neighbourhood}, Kampala`,
          sender_item_id: reportId,
        },
      ],
    },
  });

  return {
    batchId: data.batch_header?.payout_batch_id,
    senderBatchId: data.batch_header?.sender_batch_header?.sender_batch_id || senderBatchId,
    batchStatus: data.batch_header?.batch_status, // usually PENDING right after creation
    itemStatus: 'PENDING',
    simulated: false,
  };
}

/** Poll a payout batch — PayPal processes payouts asynchronously. */
export async function getPayoutStatus(batchId) {
  if (!config.paypal.enabled || String(batchId).startsWith('SIM-')) {
    return { batchId, batchStatus: 'SUCCESS', itemStatus: 'SUCCESS', simulated: true };
  }
  const data = await paypalFetch(`/v1/payments/payouts/${encodeURIComponent(batchId)}`);
  const item = data.items?.[0];
  return {
    batchId,
    batchStatus: data.batch_header?.batch_status,
    itemStatus: item?.transaction_status, // SUCCESS | PENDING | UNCLAIMED | FAILED | RETURNED | BLOCKED | ...
    payoutItemId: item?.payout_item_id,
    transactionId: item?.transaction_id,
    errors: item?.errors,
    fee: item?.payout_item_fee?.value,
    simulated: false,
  };
}

/** Item statuses that mean money will not reach the household from this batch. */
export const FAILED_ITEM_STATUSES = ['FAILED', 'RETURNED', 'BLOCKED', 'REFUNDED', 'REVERSED', 'DENIED'];

export const paypalInfo = () => ({
  mode: config.paypal.mode,
  configured: config.paypal.enabled,
  clientId: config.paypal.enabled ? config.paypal.clientId : null,
});
