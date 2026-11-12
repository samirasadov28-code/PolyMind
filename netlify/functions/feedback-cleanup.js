// Scheduled feedback cleanup — deletes feedback entries older than 30 days
// from Netlify Blobs, so stored feedback (message, optional email, UA, IP)
// is not retained longer than the stated retention window.
// Runs daily via the schedule declared in netlify.toml.

const { getStore } = require('@netlify/blobs');

const RETENTION_DAYS = 30;
const CUTOFF_MS = RETENTION_DAYS * 24 * 60 * 60 * 1000;

exports.handler = async function () {
  const store = getStore('feedback');
  const cutoff = Date.now() - CUTOFF_MS;

  let scanned = 0, deleted = 0, kept = 0, unknownAge = 0, errors = 0;
  let cursor;

  do {
    const page = await store.list({ cursor });
    for (const blob of page.blobs) {
      scanned++;
      let createdMs = NaN;
      try {
        const entry = await store.get(blob.key, { type: 'json' });
        if (entry && entry.createdAt) createdMs = Date.parse(entry.createdAt);
      } catch (e) { errors++; }

      // Never delete an entry whose age cannot be determined.
      if (Number.isNaN(createdMs)) { unknownAge++; continue; }

      if (createdMs < cutoff) {
        try { await store.delete(blob.key); deleted++; }
        catch (e) { errors++; }
      } else {
        kept++;
      }
    }
    cursor = page.cursor || undefined;
  } while (cursor);

  const summary = { ok: true, retentionDays: RETENTION_DAYS, scanned, deleted, kept, unknownAge, errors };
  console.log('feedback-cleanup', JSON.stringify(summary));
  return { statusCode: 200, body: JSON.stringify(summary) };
};
