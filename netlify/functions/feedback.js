// Feedback collector — stores each submission in Netlify Blobs and (if
// configured) forwards a summary to FEEDBACK_WEBHOOK_URL. That URL can be a
// Discord webhook, Slack incoming webhook, or any endpoint that accepts JSON.
//
// Env vars (both optional):
//   FEEDBACK_WEBHOOK_URL  →  POST target for forwarded feedback (recommended)
//   FEEDBACK_WEBHOOK_KIND →  'discord' | 'slack' | 'generic' (default: autodetect)

const { getStore } = require('@netlify/blobs');
const crypto = require('crypto');

const MAX_LEN = 4000;
const MIN_LEN = 5;

function sanitize(s, max) {
  return String(s || '').slice(0, max).replace(/[\u0000-\u001F\u007F]/g, ' ').trim();
}

function detectKind(url) {
  if (!url) return 'generic';
  if (url.includes('discord.com/api/webhooks') || url.includes('discordapp.com/api/webhooks')) return 'discord';
  if (url.includes('hooks.slack.com')) return 'slack';
  return 'generic';
}

function formatForDiscord(entry) {
  const lines = [
    `**PolyMind feedback** · ${entry.category}`,
    `version: \`${entry.meta.version}\` · tier: \`${entry.meta.tier}\``,
    entry.email ? `email: ${entry.email}` : 'email: (none)',
    '',
    entry.message,
  ];
  return { content: lines.join('\n').slice(0, 1900) };
}

function formatForSlack(entry) {
  const header = `*PolyMind feedback* · ${entry.category}\nversion: \`${entry.meta.version}\` · tier: \`${entry.meta.tier}\` · ${entry.email || '(no email)'}`;
  return { text: `${header}\n\n${entry.message}` };
}

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

  let body;
  try { body = JSON.parse(event.body || '{}'); }
  catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Invalid JSON' }) };
  }

  const message = sanitize(body.message, MAX_LEN);
  if (message.length < MIN_LEN) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: 'Please write a few more words so we can help.' }) };
  }
  const email = sanitize(body.email, 200);
  const category = sanitize(body.category || 'general', 40);
  const meta = {
    version: sanitize((body.meta && body.meta.version) || '?', 20),
    tier: sanitize((body.meta && body.meta.tier) || '?', 10),
    url: sanitize((body.meta && body.meta.url) || '', 200),
    ua: sanitize(event.headers['user-agent'] || '', 200),
    ip: sanitize(event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || '', 64),
  };

  const id = new Date().toISOString().replace(/[:.]/g, '-') + '-' + crypto.randomBytes(3).toString('hex');
  const entry = { id, createdAt: new Date().toISOString(), category, email, message, meta };

  try {
    const store = getStore('feedback');
    await store.setJSON(`entry:${id}`, entry);
  } catch (e) {
    // Don't fail the user submission just because blob write failed.
  }

  const hookUrl = process.env.FEEDBACK_WEBHOOK_URL;
  if (hookUrl) {
    const kind = (process.env.FEEDBACK_WEBHOOK_KIND || detectKind(hookUrl)).toLowerCase();
    let payload;
    if (kind === 'discord') payload = formatForDiscord(entry);
    else if (kind === 'slack') payload = formatForSlack(entry);
    else payload = entry;
    try {
      await fetch(hookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch (e) {
      // Webhook failure is non-fatal — feedback is still stored in blobs.
    }
  }

  return { statusCode: 200, headers, body: JSON.stringify({ ok: true, id }) };
};
