const crypto = require("crypto");

/**
 * HMAC webhook signature verification (the same scheme Stripe, GitHub,
 * and most real webhook providers use). Sender computes:
 *   HMAC_SHA256(secret, `${timestamp}.${rawBody}`)
 * sent as x-webhook-signature, alongside x-webhook-timestamp. We
 * recompute and compare using a timing-safe comparison, and reject
 * timestamps outside a tolerance window to block replay attacks.
 */
const TOLERANCE_SECONDS = 5 * 60;

function sign(secret, timestamp, rawBody) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function verify(secret, timestamp, rawBody, providedSignature) {
  if (!timestamp || !providedSignature) return { ok: false, reason: "missing signature headers" };

  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (!Number.isFinite(age) || age > TOLERANCE_SECONDS) {
    return { ok: false, reason: "timestamp outside tolerance (possible replay)" };
  }

  const expected = sign(secret, timestamp, rawBody);
  const expectedBuf = Buffer.from(expected, "hex");
  const providedBuf = Buffer.from(providedSignature, "hex");

  if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
    return { ok: false, reason: "signature mismatch" };
  }
  return { ok: true };
}

module.exports = { sign, verify };
