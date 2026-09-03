function required(name, fallback) {
  const val = process.env[name] ?? fallback;
  if (val === undefined) throw new Error(`Missing required environment variable: ${name}`);
  return val;
}

const config = {
  port: Number(process.env.PORT || 4000),
  redisUrl: required("REDIS_URL", "redis://localhost:6379"),
  databaseUrl: required("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/webhooks?schema=public"),
  webhookSecret: process.env.WEBHOOK_SECRET || "", // HMAC signing key; empty = signature check disabled (dev only)
  concurrency: Number(process.env.CONCURRENCY || 20),
  maxAttempts: Number(process.env.MAX_ATTEMPTS || 5),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 6000),
  nodeEnv: process.env.NODE_ENV || "development",
};

module.exports = { config };
