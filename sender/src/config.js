require("dotenv").config();

// RECEIVER_URL: hostname only, as injected by Render's fromService (see
// render.yaml) - we build the full URL ourselves.
// RECEIVER_WEBHOOK_URL: a complete URL, used by docker-compose and local
// runs where the target is already known in full.
function resolveDefaultTargetUrl() {
  if (process.env.RECEIVER_URL) return `https://${process.env.RECEIVER_URL}/webhook`;
  if (process.env.RECEIVER_WEBHOOK_URL) return process.env.RECEIVER_WEBHOOK_URL;
  return "http://localhost:4000/webhook";
}

module.exports = {
  port: Number(process.env.PORT || 5000),
  // Must match the receiver's WEBHOOK_SECRET so signed requests verify.
  webhookSecret: process.env.WEBHOOK_SECRET || "",
  defaultTargetUrl: resolveDefaultTargetUrl(),
  nodeEnv: process.env.NODE_ENV || "development",
};
