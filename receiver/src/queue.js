const { Queue, QueueEvents } = require("bullmq");
const { connection } = require("./redis");
const { config } = require("./config");

/**
 * Durable job queue backed by Redis via BullMQ. Jobs survive a process
 * restart or crash - any worker (including a freshly restarted one, or
 * one on a different machine entirely) can pick a job back up. Failed
 * jobs beyond maxAttempts land in Bull's "failed" set, which we treat
 * as an inspectable, re-runnable dead-letter queue.
 */
const QUEUE_NAME = "webhook-messages";

const webhookQueue = new Queue(QUEUE_NAME, { connection });
const queueEvents = new QueueEvents(QUEUE_NAME, { connection });

module.exports = { webhookQueue, queueEvents, QUEUE_NAME, maxAttempts: config.maxAttempts };
