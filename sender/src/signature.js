const crypto = require("crypto");

/**
 * Mirrors receiver/src/signature.js verify(). Signs the exact raw JSON
 * bytes being sent, prefixed with a timestamp, so the receiver can
 * confirm both authenticity (only someone with the shared secret could
 * produce this signature) and freshness (rejects stale/replayed
 * requests outside its tolerance window).
 */
function sign(secret, timestamp, rawBody) {
  return crypto.createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

module.exports = { sign };
