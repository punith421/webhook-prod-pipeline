/**
 * The actual business logic for a message. Swap this for your real
 * workload: a DB write, a third-party API call, a file generation, an
 * email send, etc. Kept as simulated I/O (50-200ms) so throughput is
 * easy to observe end-to-end.
 */
function simulateWork(message) {
  const delayMs = 50 + Math.floor(Math.random() * 150);
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve({
        id: message.id,
        status: "processed",
        reply: `ack:${message.text}`,
        tookMs: delayMs,
        processedAt: Date.now(),
      });
    }, delayMs);
  });
}

module.exports = { simulateWork };
