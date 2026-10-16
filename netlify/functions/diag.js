exports.handler = async function () {
  const keys = Object.keys(process.env).filter(k => /blobs|site|netlify|token|context/i.test(k)).sort();
  const out = {};
  for (const k of keys) out[k] = (process.env[k] || '').slice(0, 24) + (process.env[k] && process.env[k].length > 24 ? '...(' + process.env[k].length + ')' : '');
  let blobsErr = null, blobsOk = false;
  try {
    const { getStore } = require('@netlify/blobs');
    const s = getStore('pro-codes');
    await s.get('__diag__', { type: 'json' });
    blobsOk = true;
  } catch (e) { blobsErr = e.message; }
  return { statusCode: 200, body: JSON.stringify({ env: out, blobsOk, blobsErr }, null, 2) };
};
