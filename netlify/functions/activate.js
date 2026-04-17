// Pro activation — validates a redemption code.
//
// Check order:
//   1. Netlify Blobs "pro-codes" store (codes auto-issued by stripe-webhook)
//   2. PRO_CODES env var (comma-separated; for manual/admin codes)
//
// Matching is case-insensitive and whitespace-trimmed.

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
    return { statusCode: 405, headers, body: JSON.stringify({ valid: false, error: 'Method not allowed' }) };
  }

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ valid: false, error: 'Invalid JSON' }) };
  }

  const code = String(body.code || '').trim().toUpperCase();
  if (!code) {
    return { statusCode: 400, headers, body: JSON.stringify({ valid: false, error: 'Code required' }) };
  }

  // 1. Blob-issued code (Stripe webhook)
  try {
    const store = getStore('pro-codes');
    const entry = await store.get(`code:${code}`, { type: 'json' });
    if (entry && entry.active) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: true, source: 'blob' }) };
    }
    if (entry && entry.active === false) {
      return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'Code revoked' }) };
    }
  } catch (e) {
    // Blob store not available — fall through to env var
  }

  // 2. Env-var codes (manual/admin)
  const raw = process.env.PRO_CODES || '';
  const envCodes = raw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  if (envCodes.includes(code)) {
    return { statusCode: 200, headers, body: JSON.stringify({ valid: true, source: 'env' }) };
  }

  return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'Invalid or expired code' }) };
};
