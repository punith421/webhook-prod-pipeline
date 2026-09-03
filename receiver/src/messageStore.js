const { Prisma } = require("@prisma/client");
const { prisma } = require("./db");

async function createReceivedMessage(payload) {
  try {
    const message = await prisma.message.create({
      data: {
        externalMessageId: payload.id,
        text: payload.text,
        replyTo: payload.replyTo,
        status: "RECEIVED",
      },
    });
    return { created: true, message };
  } catch (err) {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
      const message = await prisma.message.findUnique({
        where: { externalMessageId: payload.id },
      });
      return { created: false, message };
    }
    throw err;
  }
}

function markQueued(externalMessageId, queueJobId) {
  return prisma.message.update({
    where: { externalMessageId },
    data: {
      queueJobId,
      status: "QUEUED",
      queuedAt: new Date(),
      error: null,
    },
  });
}

function markProcessing(externalMessageId, attemptNumber) {
  return prisma.message.update({
    where: { externalMessageId },
    data: {
      status: "PROCESSING",
      retries: Math.max(attemptNumber - 1, 0),
      processingAt: new Date(),
      error: null,
    },
  });
}

function markProcessed(externalMessageId) {
  return prisma.message.update({
    where: { externalMessageId },
    data: {
      status: "PROCESSED",
      processedAt: new Date(),
      error: null,
    },
  });
}

function markFailed(externalMessageId, error, attemptNumber) {
  return prisma.message.update({
    where: { externalMessageId },
    data: {
      status: "FAILED",
      retries: Math.max(attemptNumber - 1, 0),
      failedAt: new Date(),
      error: error ? String(error).slice(0, 4000) : "Unknown error",
    },
  });
}

function markEnqueueFailed(externalMessageId, error) {
  return prisma.message.update({
    where: { externalMessageId },
    data: {
      status: "FAILED",
      failedAt: new Date(),
      error: error ? String(error).slice(0, 4000) : "Failed to enqueue message",
    },
  });
}

function markAttemptFailed(externalMessageId, error, attemptNumber, willRetry) {
  return prisma.message.update({
    where: { externalMessageId },
    data: {
      status: willRetry ? "QUEUED" : "FAILED",
      retries: Math.max(attemptNumber - 1, 0),
      failedAt: willRetry ? undefined : new Date(),
      error: error ? String(error).slice(0, 4000) : "Unknown error",
    },
  });
}

function getStatusCounts() {
  return prisma.message.groupBy({
    by: ["status"],
    _count: { status: true },
  });
}

module.exports = {
  createReceivedMessage,
  markQueued,
  markProcessing,
  markProcessed,
  markFailed,
  markEnqueueFailed,
  markAttemptFailed,
  getStatusCounts,
};
