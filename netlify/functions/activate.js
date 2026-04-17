// Pro activation — validates a redemption code against the PRO_CODES env var.
// PRO_CODES = comma-separated list, e.g. "PM-ABCD-1234,PM-FOUNDER-0001"
// Matching is case-insensitive and whitespace-trimmed.

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

  const raw = process.env.PRO_CODES || '';
  const valid = raw.split(',').map(c => c.trim().toUpperCase()).filter(Boolean);

  if (valid.length === 0) {
    return { statusCode: 503, headers, body: JSON.stringify({ valid: false, error: 'Activation not configured' }) };
  }

  if (valid.includes(code)) {
    return { statusCode: 200, headers, body: JSON.stringify({ valid: true }) };
  }
  return { statusCode: 200, headers, body: JSON.stringify({ valid: false, error: 'Invalid or expired code' }) };
};
