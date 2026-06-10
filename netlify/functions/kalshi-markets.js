// Fetches Kalshi public market data server-side to avoid CORS.
// No auth required — Kalshi allows public reads on /markets.

exports.handler = async function(event) {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, OPTIONS',
    'Content-Type': 'application/json',
    'Cache-Control': 'no-cache',
  };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers };

  try {
    const resp = await fetch(
      'https://trading-api.kalshi.com/trade-api/v2/markets?limit=200',
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0 (compatible; PolyMind/1.30)',
        },
      }
    );

    if (!resp.ok) {
      const errText = await resp.text().catch(() => '');
      console.error('[kalshi-markets] API error', resp.status, errText.slice(0, 200));
      return {
        statusCode: resp.status,
        headers,
        body: JSON.stringify({ error: 'Kalshi API returned ' + resp.status }),
      };
    }

    const data = await resp.json();
    return { statusCode: 200, headers, body: JSON.stringify(data) };
  } catch(e) {
    console.error('[kalshi-markets] fetch failed:', e.message);
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message }),
    };
  }
};
