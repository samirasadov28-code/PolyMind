// Stripe webhook — issues a unique Pro activation code per paid session.
//
// Env vars required on Netlify:
//   STRIPE_WEBHOOK_SECRET  →  whsec_... from Stripe Dashboard → Webhooks
//   STRIPE_SECRET_KEY      →  sk_live_... (needed for purchase re-validation)
//   POLYMIND_PRICE_ID      →  price_... of the $3.99 product (recommended)
//
// Stripe setup:
//   1. Dashboard → Developers → Webhooks → Add endpoint
//      URL:    https://polyminds.netlify.app/api/stripe-webhook
//      Events: checkout.session.completed
//              checkout.session.async_payment_succeeded
//              charge.refunded
//              charge.dispute.created
//   2. Copy the signing secret (whsec_...) into STRIPE_WEBHOOK_SECRET on Netlify.
//   3. On your Payment Link, set the confirmation page URL to:
//      https://polyminds.netlify.app/?session_id={CHECKOUT_SESSION_ID}
//
// Storage: Netlify Blobs, store "pro-codes"
//   code:{CODE}             → { active, sessionId, email, customerId, createdAt, paymentIntent }
//   session:{SESSION_ID}    → { code }
//   pi:{PAYMENT_INTENT_ID}  → { code, codes[] }  (reverse index for refund/dispute revocation)
//   customer:{CUSTOMER_ID}  → { codes[] }         (reverse index — kept for future use)
// Idempotent: a second webhook for the same session returns the existing code.
//
// Handled events:
//   checkout.session.completed               → issue a Pro code (one-off payment only)
//   checkout.session.async_payment_succeeded → same (bank transfers, delayed methods)
//   charge.refunded (full only)              → revoke all codes for that payment
//   charge.dispute.created                   → revoke all codes for that payment

const crypto = require('crypto');
const { getStore, connectLambda } = require('@netlify/blobs');

const ALPHA = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // no I, L, O, 0, 1

// Deterministic per session: a duplicate delivery of the same event always derives
// the same code, so a stale read can never produce a second, different code.
function codeForSession(sessionId, secret) {
  const bytes = crypto.createHmac('sha256', secret).update('polymind-code:' + sessionId).digest();
  const group = (i) => {
    let out = '';
    for (let j = 0; j < 4; j++) out += ALPHA[bytes[i * 4 + j] % ALPHA.length];
    return out;
  };
  return `PM-${group(0)}-${group(1)}-${group(2)}`;
}

function generateCode() {
  const bytes = crypto.randomBytes(12);
  const group = (i) => {
    let out = '';
    for (let j = 0; j < 4; j++) out += ALPHA[bytes[i * 4 + j] % ALPHA.length];
    return out;
  };
  return `PM-${group(0)}-${group(1)}-${group(2)}`;
}

function verifyStripeSignature(payload, sigHeader, secret) {
  if (!sigHeader || !secret) return false;
  const parts = sigHeader.split(',').reduce((acc, p) => {
    const idx = p.indexOf('=');
    if (idx > 0) acc[p.slice(0, idx)] = p.slice(idx + 1);
    return acc;
  }, {});
  const timestamp = parts.t;
  const signature = parts.v1;
  if (!timestamp || !signature) return false;

  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - parseInt(timestamp, 10)) > 300) return false; // 5 min tolerance

  const signed = `${timestamp}.${payload}`;
  const expected = crypto.createHmac('sha256', secret).update(signed).digest('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(signature, 'hex'), Buffer.from(expected, 'hex'));
  } catch (e) {
    return false;
  }
}


// ── Purchase validation (added: paid + right product + right price) ──────────
const PRICE_ID = process.env.POLYMIND_PRICE_ID || '';      // optional but recommended: price_...
const PRODUCT_ID = process.env.POLYMIND_PRODUCT_ID || '';  // optional: prod_...

async function stripeGet(path) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('STRIPE_SECRET_KEY missing');
  const res = await fetch('https://api.stripe.com/v1' + path, { headers: { Authorization: 'Bearer ' + key } });
  if (!res.ok) throw new Error('Stripe ' + res.status);
  return res.json();
}

// Returns { ok:true } or { ok:false, reason }. Never trusts the webhook body alone:
// re-reads the session from Stripe with its line items.
async function validatePurchase(sessionId) {
  const s = await stripeGet('/checkout/sessions/' + encodeURIComponent(sessionId) + '?expand[]=line_items.data.price');
  if (s.mode !== 'payment') return { ok: false, reason: 'not a one-off payment' };
  if (s.payment_status !== 'paid') return { ok: false, reason: 'unpaid' };
  const items = (s.line_items && s.line_items.data) || [];
  if (items.length !== 1) return { ok: false, reason: 'unexpected line items' };
  const li = items[0];
  const price = li.price || {};
  if (PRICE_ID) {
    if (price.id !== PRICE_ID) return { ok: false, reason: 'wrong price id' };
  } else if (PRODUCT_ID) {
    if (price.product !== PRODUCT_ID) return { ok: false, reason: 'wrong product' };
  } else {
    // Fallback until POLYMIND_PRICE_ID is set: exact amount + name match. (amount_subtotal, not amount_total: the payment link has automatic tax on, so total can exceed 3.99)
    if (!/polymind/i.test(li.description || '')) return { ok: false, reason: 'wrong product name' };
  }
  if (s.currency !== 'usd' || s.amount_subtotal !== 399 || price.unit_amount !== 399) {
    return { ok: false, reason: 'wrong amount' };
  }
  return { ok: true, paymentIntent: s.payment_intent || null, session: s };
}

exports.handler = async function (event) {
  connectLambda(event); // required by @netlify/blobs v8 in Lambda-compat handlers
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: 'Method not allowed' };
  }

  const secret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret) {
    return { statusCode: 503, body: 'Webhook not configured' };
  }

  const raw = event.isBase64Encoded
    ? Buffer.from(event.body || '', 'base64').toString('utf8')
    : (event.body || '');

  const sigHeader = event.headers['stripe-signature'] || event.headers['Stripe-Signature'];
  if (!verifyStripeSignature(raw, sigHeader, secret)) {
    return { statusCode: 400, body: 'Invalid signature' };
  }

  let payload;
  try { payload = JSON.parse(raw); }
  catch (e) { return { statusCode: 400, body: 'Invalid JSON' }; }

  const store = getStore('pro-codes');

  if (payload.type === 'checkout.session.completed' || payload.type === 'checkout.session.async_payment_succeeded') {
    const session = payload.data && payload.data.object;
    if (!session || !session.id) {
      return { statusCode: 400, body: 'Missing session' };
    }

    // Idempotency — if we already issued a code for this session, return it.
    const existing = await store.get(`session:${session.id}`, { type: 'json' });
    if (existing && existing.code) {
      return { statusCode: 200, body: JSON.stringify({ code: existing.code, reused: true }) };
    }

    // Validate with Stripe: paid, one-off, right product/price/amount.
    let check;
    try { check = await validatePurchase(session.id); }
    catch (e) { return { statusCode: 500, body: 'Validation unavailable, Stripe will retry' }; }
    if (!check.ok) {
      return { statusCode: 200, body: JSON.stringify({ ignored: true, reason: check.reason }) };
    }

    // Same session always yields the same code (see codeForSession).
    const code = codeForSession(session.id, secret);
    const clash = await store.get(`code:${code}`, { type: 'json' });
    if (clash && clash.sessionId && clash.sessionId !== session.id) {
      return { statusCode: 500, body: 'Code collision' };
    }

    const entry = {
      active: true,
      sessionId: session.id,
      email: (session.customer_details && session.customer_details.email) || session.customer_email || null,
      customerId: session.customer || null,
      createdAt: new Date().toISOString(),
    };

    entry.paymentIntent = check.paymentIntent;
    // Never overwrite an existing entry for this session (it may already be revoked or carry an email).
    if (!clash) await store.setJSON(`code:${code}`, entry);
    await store.setJSON(`session:${session.id}`, { code });
    if (check.paymentIntent) {
      const piKey = `pi:${check.paymentIntent}`;
      const piEntry = (await store.get(piKey, { type: 'json' })) || {};
      const codes = Array.isArray(piEntry.codes) ? piEntry.codes.slice() : (piEntry.code ? [piEntry.code] : []);
      if (!codes.includes(code)) codes.push(code);
      await store.setJSON(piKey, { code: codes[0], codes });
    }

    // Reverse index: customer → codes (for future cancellation webhook)
    if (entry.customerId) {
      const custKey = `customer:${entry.customerId}`;
      const custEntry = (await store.get(custKey, { type: 'json' })) || { codes: [] };
      if (!custEntry.codes.includes(code)) custEntry.codes.push(code);
      await store.setJSON(custKey, custEntry);
    }

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, issued: true }),
    };
  }

  if (payload.type === 'charge.refunded' || payload.type === 'charge.dispute.created') {
    const obj = payload.data && payload.data.object;
    const pi = obj && obj.payment_intent;
    if (!pi) return { statusCode: 200, body: 'No payment_intent' };
    // Only fully refunded charges revoke; partial refunds keep access.
    if (payload.type === 'charge.refunded' && !(obj.refunded === true || (obj.amount_refunded >= obj.amount))) {
      return { statusCode: 200, body: 'Partial refund ignored' };
    }
    const link = await store.get(`pi:${pi}`, { type: 'json' });
    const linked = link ? (Array.isArray(link.codes) && link.codes.length ? link.codes : (link.code ? [link.code] : [])) : [];
    if (!linked.length) return { statusCode: 200, body: 'No code for payment' };
    // Revoke every code tied to this payment, not just the first.
    for (const c of linked) {
      const codeEntry = await store.get(`code:${c}`, { type: 'json' });
      if (codeEntry && codeEntry.active) {
        codeEntry.active = false;
        codeEntry.deactivatedAt = new Date().toISOString();
        codeEntry.deactivatedReason = payload.type;
        await store.setJSON(`code:${c}`, codeEntry);
      }
    }
    return { statusCode: 200, body: JSON.stringify({ revoked: linked[0], revokedAll: linked }) };
  }

  return { statusCode: 200, body: 'Ignored' };
};

