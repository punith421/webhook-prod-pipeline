const { Worker } = require("bullmq");
const { connection } = require("./redis");
const { prisma } = require("./db");
const { config } = require("./config");
const { logger } = require("./logger");
const { QUEUE_NAME } = require("./queue");
const { simulateWork } = require("./work");
const { markProcessing, markProcessed, markAttemptFailed } = require("./messageStore");

/**
 * This is a SEPARATE PROCESS from server.js on purpose. In production
 * you run N of these (via `docker-compose up --scale worker=N`, a
 * Kubernetes Deployment with multiple replicas, or several ECS tasks),
 * completely independently of how many API instances you run. The API
 * layer just needs to accept requests fast; the worker layer is where
 * you scale up when the actual processing work is the bottleneck.
 *
 * BullMQ workers pull jobs from Redis, so any worker process, on any
 * machine, can pick up any job - there's no in-memory state tying a
 * job to a specific process.
 */
const worker = new Worker(
  QUEUE_NAME,
  async (job) => {
    const { id, text, replyTo } = job.data;
    const currentAttempt = job.attemptsMade + 1;

    try {
      await markProcessing(id, currentAttempt);
      const result = await simulateWork({ id, text });

      if (replyTo) {
        await deliverReplyWithRetry(replyTo, result, job.id);
      }

      await markProcessed(id);
      return result;
    } catch (err) {
      const maxAttempts = Number(job.opts.attempts || config.maxAttempts);
      const willRetry = currentAttempt < maxAttempts;
      await markAttemptFailed(id, err.message, currentAttempt, willRetry);
      throw err;
    }
  },
  {
    connection,
    concurrency: config.concurrency,
  }
);

async function deliverReplyWithRetry(url, payload, jobId, maxAttempts = 4) {
  let attempt = 0;
  let lastError;
  while (attempt < maxAttempts) {
    attempt++;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(5000),
      });
      if (res.ok) {
        logger.info({ jobId, attempt, status: res.status }, "reply webhook delivered");
        return;
      }
      lastError = new Error(`reply webhook responded ${res.status}`);
    } catch (err) {
      lastError = err;
    }
    const backoffMs = 250 * 2 ** (attempt - 1);
    logger.warn({ jobId, attempt, error: lastError.message }, "reply webhook delivery failed, retrying");
    await new Promise((r) => setTimeout(r, backoffMs));
  }
  logger.error({ jobId, error: lastError?.message }, "reply webhook delivery permanently failed");
  throw lastError;
}

worker.on("completed", (job) => logger.info({ jobId: job.id }, "job completed"));
worker.on("failed", (job, err) => logger.error({ jobId: job?.id, err: err.message }, "job failed"));

logger.info(`Worker started, concurrency=${config.concurrency}`);

function shutdown(signal) {
  logger.info(`${signal} received, closing worker gracefully`);
  worker
    .close()
    .then(() => connection.quit())
    .then(() => prisma.$disconnect())
    .then(() => process.exit(0));
  setTimeout(() => process.exit(1), 15_000).unref();
}
process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
