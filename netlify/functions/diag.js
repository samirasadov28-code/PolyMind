const { getStore, connectLambda } = require('@netlify/blobs');
exports.handler = async function (event) {
  let blobsErr = null, blobsOk = false, wrote = null;
  try {
    connectLambda(event);
    const s = getStore('pro-codes');
    await s.setJSON('__diag__', { ts: Date.now() });
    const v = await s.get('__diag__', { type: 'json' });
    wrote = v;
    blobsOk = true;
  } catch (e) { blobsErr = e.message; }
  return { statusCode: 200, body: JSON.stringify({ blobsOk, blobsErr, wrote }, null, 2) };
};
