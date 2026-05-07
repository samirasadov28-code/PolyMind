// ─── PolyMind AI Proxy ────────────────────────────────────────────────────────
// Runs server-side on Netlify — the GROQ_API_KEY environment variable is never
// sent to the browser. Claude and Gemini keys are supplied by the user and
// forwarded, but they never appear in your source code or GitHub repo.
//
// Environment variables to set in Netlify dashboard:
//   GROQ_API_KEY  →  your Groq key from console.groq.com
//
// Endpoint: POST /api/ai
// Body (alert analysis): { provider, key, message, system }
// Body (chat):           { provider, key, messages: [{role,content},...], system, max_tokens? }
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

  const { provider = 'groq', key, message, messages, system, max_tokens } = body;

  // Validate
  if (!message && !(Array.isArray(messages) && messages.length)) {
    return { statusCode: 400, body: JSON.stringify({ error: 'Missing message or messages' }) };
  }

  const headers = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  // Cap conversation length defensively (latest 30 turns).
  const trimmedMessages = Array.isArray(messages)
    ? messages
        .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
        .slice(-30)
        .map(m => ({ role: m.role, content: m.content }))
    : null;
  const isChat = !!trimmedMessages;
  const maxTokens = Math.min(Math.max(parseInt(max_tokens, 10) || (isChat ? 600 : 900), 64), 1500);

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
      const groqMessages = [{ role: 'system', content: system || '' }];
      if (isChat) {
        groqMessages.push(...trimmedMessages);
      } else {
        groqMessages.push({ role: 'user', content: 'Analyze this prediction market signal:\n\n' + message });
      }
      const resp = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + groqKey },
        body: JSON.stringify({
          model: 'llama-3.3-70b-versatile',
          max_tokens: maxTokens,
          messages: groqMessages
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error((data.error && (data.error.message || data.error.code)) || 'Groq HTTP ' + resp.status);
      text = data.choices[0].message.content;

    // ── CLAUDE (user-supplied key forwarded server-side) ──────────────────────
    } else if (provider === 'claude') {
      if (!key) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Claude key required' }) };
      const claudeMessages = isChat
        ? trimmedMessages
        : [{ role: 'user', content: 'Analyze:\n\n' + message }];
      const resp = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': key,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify({
          model: 'claude-sonnet-4-20250514',
          max_tokens: maxTokens,
          system: system,
          messages: claudeMessages
        })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error((data.error && data.error.message) || 'Claude HTTP ' + resp.status);
      text = (data.content || []).map(c => c.text || '').join('');

    // ── GEMINI (user-supplied key forwarded server-side) ──────────────────────
    } else if (provider === 'gemini') {
      if (!key) return { statusCode: 400, headers, body: JSON.stringify({ error: 'Gemini key required' }) };
      const geminiContents = isChat
        ? trimmedMessages.map(m => ({
            role: m.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: m.content }]
          }))
        : [{ role: 'user', parts: [{ text: 'Analyze:\n\n' + message }] }];
      const resp = await fetch(
        'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=' + key,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: geminiContents
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
