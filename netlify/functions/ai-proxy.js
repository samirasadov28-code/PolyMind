// ─── PolyMind AI Proxy ────────────────────────────────────────────────────────
// Runs server-side on Netlify — the GROQ_API_KEY environment variable is never
// sent to the browser. Claude and Gemini keys are supplied by the user and
// forwarded, but they never appear in your source code or GitHub repo.
//
// Environment variables to set in Netlify dashboard:
//   GROQ_API_KEY  →  your Groq key from console.groq.com
//
// Endpoint: POST /api/ai
// Body: { provider: 'groq'|'claude'|'gemini', key: string|null, message: string, system: string }
// ─────────────────────────────────────────────────────────────────────────────

exports.handler = async function(event) {
  // Only allow POST
  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, body: JSON.stringify({ error: 'Method not allowed' }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch(e) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Invalid JSON body' }) };
  }

  const { provider = 'groq', key, message, system } = body;

  // Validate
  if (!message) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing message' }) };
  }

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  try {
    let text = '';

    // ── GROQ (default — uses server-side env var, key never sent to browser) ──
    if (provider === 'groq') {
      const groqKey = process.env.GROQ_API_KEY;
      if (!groqKey) {
        return {
          statusCode: 500,
          headers,
          body: JSON.stringify({ error: 'GROQ_API_KEY not configured in Netlify environment variables' })
        };
      }
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: 900,
          messages: [
            { role: 'system', content: system },
            { role: 'user',   content: 'Analyze this prediction market signal:\n\n' + message }
          ]
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error((data.error && (data.error.message || data.error.code)) || 'Groq HTTP ' + resp.status);
      text = data.choices[0].message.content;

    // ── CLAUDE (user-supplied key forwarded server-side) ──────────────────────
    } else if (provider === 'claude') {
      if (!key) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Claude key required' }) };
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 900,
          system: system,
          messages: [{ role: 'user', content: 'Analyze:\n\n' + message }]
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error((data.error && data.error.message) || 'Claude HTTP ' + resp.status);
      text = (data.content || []).map(c => c.text || '').join('');

    // ── GEMINI (user-supplied key forwarded server-side) ──────────────────────
    } else if (provider === 'gemini') {
      if (!key) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Gemini key required' }) };
      const resp = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: [{ role: 'user', parts: [{ text: 'Analyze:\n\n' + message }] }]
          })
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error((data.error && data.error.message) || 'Gemini HTTP ' + resp.status);
      text = data.candidates[0].content.parts[0].text;

    } else {
      return { statusCode: 400, headers, body: JSON.stringify({ error: 'Unknown provider: ' + provider }) };
    }

    return {
      statusCode: 200,
      headers,
      body: JSON.stringify({ text })
    };

  } catch(e) {
    return {
      statusCode: 502,
      headers,
      body: JSON.stringify({ error: e.message || 'AI proxy error' })
    };
  }
};
