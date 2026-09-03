const IORedis = require("ioredis");
const { config } = require("./config");
const { logger } = require("./logger");

const connection = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });

connection.on("error", (err) => logger.error({ err }, "Redis connection error"));
connection.on("connect", () => logger.info("Connected to Redis"));

module.exports = { connection };
