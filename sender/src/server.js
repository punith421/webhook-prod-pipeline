const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const { WebSocketServer } = require("ws");

const config = require("./config");
const { logger } = require("./logger");
const { sign } = require("./signature");

const app = express();
app.disable("x-powered-by");
app.use(helmet());
app.use(express.json({ limit: "256kb" }));
app.use(express.static(path.join(__dirname, "..", "public")));

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const clients = new Set();
wss.on("connection", (ws) => {
  clients.add(ws);
  ws.on("close", () => clients.delete(ws));
});
function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const ws of clients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

app.get("/config", (_req, res) => {
  res.json({
    defaultReceiverWebhookUrl: config.defaultTargetUrl,
    signingEnabled: Boolean(config.webhookSecret),
  });
});

/**
 * POST /send
 * body: { count, targetUrl, replyBaseUrl, concurrency }
 *
 * Fires `count` individually-signed webhook POSTs at the receiver, with
 * bounded send concurrency. Each request carries x-webhook-timestamp
 * and x-webhook-signature headers computed with the shared secret, so
 * the receiver can verify authenticity and reject replays/tampering.
 */
app.post("/send", async (req, res) => {
  const count = Math.min(Math.max(Number(req.body.count) || 100, 1), 1000);
  const targetUrl = req.body.targetUrl || config.defaultTargetUrl;
  const replyBaseUrl = req.body.replyBaseUrl || `http://localhost:${config.port}`;
  const sendConcurrency = Math.min(Math.max(Number(req.body.concurrency) || 30, 1), 200);

  res.json({ status: "sending", count, targetUrl });
  broadcast({ type: "batch:start", count, targetUrl });

  let nextIndex = 1;
  let sent = 0;

  async function worker() {
    while (nextIndex <= count) {
      const id = nextIndex++;
      const message = { id, text: `message-${id}`, replyTo: `${replyBaseUrl}/webhook/reply` };
      const rawBody = JSON.stringify(message);
      const headers = { "Content-Type": "application/json" };

      if (config.webhookSecret) {
        const timestamp = Math.floor(Date.now() / 1000);
        headers["x-webhook-timestamp"] = String(timestamp);
        headers["x-webhook-signature"] = sign(config.webhookSecret, timestamp, rawBody);
      }

      try {
        const r = await fetch(targetUrl, { method: "POST", headers, body: rawBody, signal: AbortSignal.timeout(10_000) });
        sent++;
        broadcast({ type: "sent", id, httpStatus: r.status, sent, count });
      } catch (err) {
        sent++;
        broadcast({ type: "send-failed", id, error: err.message, sent, count });
      }
    }
  }

  const workers = Array.from({ length: Math.min(sendConcurrency, count) }, () => worker());
  await Promise.all(workers);

  broadcast({ type: "batch:sent-complete", count });
});

app.post("/webhook/reply", (req, res) => {
  broadcast({ type: "reply-received", ...(req.body || {}) });
  res.status(200).json({ status: "ack" });
});

app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

server.listen(config.port, () => {
  logger.info(`Webhook sender listening on port ${config.port}`);
  logger.info(`Default receiver URL: ${config.defaultTargetUrl}`);
  logger.info(`Signing: ${config.webhookSecret ? "ENABLED" : "disabled (set WEBHOOK_SECRET to enable)"}`);
});

function shutdown(signal) {
  logger.info(`${signal} received, shutting down`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
