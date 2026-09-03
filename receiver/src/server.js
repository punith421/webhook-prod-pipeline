const path = require("path");
const http = require("http");
const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const { WebSocketServer } = require("ws");

const { config } = require("./config");
const { prisma } = require("./db");
const { logger } = require("./logger");
const { connection } = require("./redis");
const { webhookQueue, queueEvents } = require("./queue");
const { verify } = require("./signature");
const { webhookPayloadSchema } = require("./validation");
const { createReceivedMessage, markQueued, markEnqueueFailed, getStatusCounts } = require("./messageStore");

const app = express();
app.disable("x-powered-by");
// Render (and most PaaS hosts) sit the app behind a reverse proxy, so
// req.ip / req.socket.address() would otherwise be the proxy's IP for
// every request - collapsing express-rate-limit onto one shared bucket
// instead of limiting per real client. Trusting exactly one hop is the
// correct, safe setting for a single load balancer in front of the app.
app.set("trust proxy", 1);
app.use(helmet());

// Capture the raw request body (needed for HMAC verification - signatures
// are computed over the exact bytes sent, not the re-serialized JSON).
app.use(
  express.json({
    limit: "256kb",
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  })
);

app.use(express.static(path.join(__dirname, "..", "public")));

// Protects the public endpoint from being flooded far beyond what the
// queue/workers can absorb. Tune via RATE_LIMIT_PER_MINUTE.
const webhookLimiter = rateLimit({
  windowMs: 60_000,
  max: config.rateLimitPerMinute,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "rate limit exceeded" },
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });
const dashboardClients = new Set();
wss.on("connection", (ws) => {
  dashboardClients.add(ws);
  ws.on("close", () => dashboardClients.delete(ws));
});
function broadcast(event) {
  const payload = JSON.stringify(event);
  for (const ws of dashboardClients) {
    if (ws.readyState === ws.OPEN) ws.send(payload);
  }
}

function asyncHandler(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

let totalReceived = 0;
let totalDuplicates = 0;

/**
 * POST /webhook
 * Headers: x-webhook-timestamp, x-webhook-signature
 * Body:    { id, text, replyTo }
 *
 * Production behavior, in order:
 *   1. Verify the HMAC signature (if WEBHOOK_SECRET is configured) -
 *      rejects forged or tampered requests, and rejects stale
 *      timestamps to block replay attacks.
 *   2. Create a Postgres message row keyed by the external message id.
 *      If this id was already queued, treat it as a duplicate delivery
 *      and 200 it without re-queueing (webhook senders retry on
 *      timeout, so duplicates are expected).
 *   3. Enqueue the job in BullMQ (durable - written to Redis before we
 *      respond) with automatic retries and exponential backoff.
 *   4. Respond 202 immediately. The actual work happens in a separate
 *      worker process (worker.js), which can be scaled independently
 *      and horizontally.
 */
app.post("/webhook", webhookLimiter, asyncHandler(async (req, res) => {
  if (config.webhookSecret) {
    const timestamp = req.header("x-webhook-timestamp");
    const signature = req.header("x-webhook-signature");
    const result = verify(config.webhookSecret, timestamp, req.rawBody, signature);
    if (!result.ok) {
      logger.warn({ reason: result.reason }, "rejected webhook: bad signature");
      return res.status(401).json({ error: "invalid signature", reason: result.reason });
    }
  }

  const parsed = webhookPayloadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "invalid payload",
      details: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const { id, text, replyTo } = parsed.data;
  const received = await createReceivedMessage({ id, text, replyTo });
  if (!received.created && received.message?.queueJobId) {
    totalDuplicates++;
    logger.info({ id }, "duplicate webhook delivery ignored");
    broadcast({ type: "duplicate", id, totalReceived, totalDuplicates });
    return res.status(200).json({ status: "duplicate-ignored", id });
  }

  totalReceived++;
  broadcast({ type: "received", id, text, totalReceived, totalDuplicates });

  let job;
  try {
    job = await webhookQueue.add(
      "process-message",
      { id, text, replyTo, messageRecordId: received.message.id },
      {
        jobId: id,
        attempts: config.maxAttempts,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { age: 3600, count: 1000 },
        removeOnFail: { age: 24 * 3600 },
      }
    );
    await markQueued(id, job.id);
  } catch (err) {
    await markEnqueueFailed(id, err.message);
    logger.error({ id, err: err.message }, "failed to enqueue webhook");
    return res.status(503).json({ error: "failed to enqueue message", id });
  }

  res.status(202).json({ status: "accepted", id, messageRecordId: received.message.id });
}));

// Forward worker progress/completion events (published via BullMQ's
// QueueEvents, which works even though the worker runs in a separate
// process) to the live dashboard.
queueEvents.on("active", ({ jobId }) => broadcast({ type: "job:active", jobId }));
queueEvents.on("completed", ({ jobId, returnvalue }) => {
  broadcast({ type: "job:completed", jobId, result: returnvalue });
});
queueEvents.on("failed", ({ jobId, failedReason }) => {
  logger.error({ jobId, failedReason }, "job failed");
  broadcast({ type: "job:failed", jobId, error: failedReason });
});

/**
 * Liveness probe - is the process up at all. Used by load balancers /
 * orchestrators to decide whether to restart the container.
 */
app.get("/healthz", (_req, res) => res.json({ status: "ok" }));

/**
 * Readiness probe - is the process ready to accept traffic (i.e. can it
 * reach Redis). Load balancers should stop routing traffic to an
 * instance that fails this, without necessarily restarting it.
 */
app.get("/readyz", asyncHandler(async (_req, res) => {
  try {
    await connection.ping();
    await prisma.$queryRaw`SELECT 1`;
    const counts = await webhookQueue.getJobCounts();
    res.json({ status: "ready", queue: counts, database: "ok" });
  } catch (err) {
    res.status(503).json({ status: "not-ready", error: err.message });
  }
}));

app.get("/metrics-summary", asyncHandler(async (_req, res) => {
  const [counts, dbStatusCounts] = await Promise.all([webhookQueue.getJobCounts(), getStatusCounts()]);
  res.json({ totalReceived, totalDuplicates, queue: counts, database: dbStatusCounts });
}));

app.use((err, req, res, _next) => {
  logger.error({ err: err.message, path: req.path }, "request failed");
  if (res.headersSent) return;
  res.status(500).json({ error: "internal server error" });
});

server.listen(config.port, () => {
  logger.info(`Webhook receiver API listening on port ${config.port}`);
  logger.info(`Webhook endpoint: POST http://localhost:${config.port}/webhook`);
  logger.info(`Dashboard:        http://localhost:${config.port}`);
  logger.info(`Signature check:  ${config.webhookSecret ? "ENABLED" : "disabled (set WEBHOOK_SECRET to enable)"}`);
});

/**
 * Graceful shutdown: stop accepting new connections, let in-flight
 * requests finish, then close the Redis connection. Important in
 * production so a rolling deploy or autoscaler scale-down doesn't drop
 * requests mid-flight.
 */
function shutdown(signal) {
  logger.info(`${signal} received, shutting down gracefully`);
  server.close(async () => {
    await queueEvents.close();
    await connection.quit();
    await prisma.$disconnect();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
