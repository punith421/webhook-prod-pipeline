const { PrismaClient } = require("@prisma/client");
const { logger } = require("./logger");

const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? [
          { emit: "event", level: "query" },
          { emit: "event", level: "error" },
          { emit: "event", level: "warn" },
        ]
      : [
          { emit: "event", level: "error" },
          { emit: "event", level: "warn" },
        ],
});

prisma.$on("error", (event) => logger.error({ event }, "Prisma error"));
prisma.$on("warn", (event) => logger.warn({ event }, "Prisma warning"));

module.exports = { prisma };
