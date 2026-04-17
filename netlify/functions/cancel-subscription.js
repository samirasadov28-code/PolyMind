// Creates a Stripe Billing Portal session for the customer behind a given
// activation code. The portal lets the customer cancel or manage billing
// directly in Stripe's hosted UI — Stripe enforces "cancel at period end, no
// refund" according to the portal configuration in the Stripe Dashboard.
//
// Env vars required:
//   STRIPE_SECRET_KEY  →  sk_live_... (or sk_test_... in test mode)
//
// Stripe setup: Dashboard → Settings → Billing → Customer portal → enable,
//   and check "Customers can cancel subscriptions" with cancellation at
//   period end. Disable refunds there if you want the "no refund" policy
//   enforced by Stripe.

const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return { statusCode: 503, headers, body: JSON.stringify({ error: 'Billing portal not configured' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const code = String(body.code || '').trim().toUpperCase();
  if (!code) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Activation code required' }) };
  }

  let customerId;
  try {
    const store = getStore('pro-codes');
    const entry = await store.get(`code:${code}`, { type: 'json' });
    if (!entry) {
      return { statusCode: 404, headers, body: JSON.stringify({ error: 'Code not found' }) };
    }
    if (!entry.customerId) {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'This code is a manual/admin grant and has no billing account to manage.' }) };
    }
    customerId = entry.customerId;
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Code lookup failed' }) };
  }

  // Figure out a sensible return_url from the Origin/Referer header
  const originHeader = event.headers.origin || event.headers.Origin || '';
  const refHeader = event.headers.referer || event.headers.Referer || '';
  let returnUrl = originHeader;
  if (!returnUrl && refHeader) {
    try { returnUrl = new URL(refHeader).origin; } catch (e) { /* ignore */ }
  }
  if (!returnUrl) returnUrl = 'https://' + (event.headers.host || 'polymind.site');
  returnUrl = returnUrl.replace(/\/$/, '') + '/';

  try {
    const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
      method: 'POST',
      headers: {
        'Authorization': 'Bearer ' + stripeKey,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: new URLSearchParams({ customer: customerId, return_url: returnUrl }).toString(),
    });
    const data = await res.json();
    if (!res.ok || !data.url) {
      return {
        statusCode: 502,
        headers,
        body: JSON.stringify({ error: (data.error && data.error.message) || 'Stripe portal error' }),
      };
    }
    return { statusCode: 200, headers, body: JSON.stringify({ url: data.url }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Portal creation failed' }) };
  }
};
