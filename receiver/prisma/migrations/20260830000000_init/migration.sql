CREATE TYPE "MessageStatus" AS ENUM ('RECEIVED', 'QUEUED', 'PROCESSING', 'PROCESSED', 'FAILED');

CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "externalMessageId" TEXT NOT NULL,
    "status" "MessageStatus" NOT NULL DEFAULT 'RECEIVED',
    "text" TEXT NOT NULL,
    "replyTo" TEXT,
    "queueJobId" TEXT,
    "retries" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "queuedAt" TIMESTAMP(3),
    "processingAt" TIMESTAMP(3),
    "processedAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Message_externalMessageId_key" ON "Message"("externalMessageId");
CREATE INDEX "Message_status_idx" ON "Message"("status");
CREATE INDEX "Message_receivedAt_idx" ON "Message"("receivedAt");
