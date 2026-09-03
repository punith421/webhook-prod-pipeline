const pino = require("pino");
const { nodeEnv } = require("./config");

const logger = pino({
  level: process.env.LOG_LEVEL || (nodeEnv === "production" ? "info" : "debug"),
  transport:
    nodeEnv === "production"
      ? undefined
      : { target: "pino-pretty", options: { colorize: true, translateTime: "HH:MM:ss" } },
});

module.exports = { logger };
