const { z } = require("zod");

const webhookPayloadSchema = z.object({
  id: z.union([z.string().min(1), z.number().int()]).transform(String),
  text: z.string().min(1).max(10_000),
  replyTo: z.string().url().optional(),
});

module.exports = { webhookPayloadSchema };
