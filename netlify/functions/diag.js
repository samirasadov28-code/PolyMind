const { getStore, connectLambda } = require('@netlify/blobs');
exports.handler = async function (event) {
  connectLambda(event);
  const key = process.env.STRIPE_SECRET_KEY || '';
  const price = process.env.POLYMIND_PRICE_ID || '';
  let stripeStatus = null, stripeErr = null;
  try {
    const res = await fetch('https://api.stripe.com/v1/checkout/sessions/cs_test_a1b8f5wMYimpWDTovjWzh78sady0f4SJZ76Zo9DbK3BHsKfRiClumxwl4D', { headers: { Authorization: 'Bearer ' + key } });
    stripeStatus = res.status;
  } catch (e) { stripeErr = e.message; }
  return { statusCode: 200, body: JSON.stringify({
    keyPrefix: key.slice(0, 12), keyLen: key.length, keyTail: key.slice(-4),
    price, stripeStatus, stripeErr
  }, null, 2) };
};
