// Fetches the activation code issued for a Stripe checkout session.
// Called by the success-page redirect: /?session_id=cs_xxx → app posts
// to /api/activation-code which returns { code }.

const { getStore } = require('@netlify/blobs');

exports.handler = async function (event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };
  if (event.httpMethod !== 'GET') {
    return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  const sessionId = (event.queryStringParameters && event.queryStringParameters.session_id) || '';
  if (!sessionId || !sessionId.startsWith('cs_')) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Missing session_id' }) };
  }

  try {
    const store = getStore('pro-codes');
    const entry = await store.get(`session:${sessionId}`, { type: 'json' });
    if (entry && entry.code) {
      return { statusCode: 200, headers, body: JSON.stringify({ code: entry.code }) };
    }
    // Not yet issued — webhook may still be in flight
    return { statusCode: 202, headers, body: JSON.stringify({ pending: true }) };
  } catch (e) {
    return { statusCode: 500, headers, body: JSON.stringify({ error: 'Lookup failed' }) };
  }
};
