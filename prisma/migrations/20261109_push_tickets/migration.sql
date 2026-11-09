-- CreateTable
CREATE TABLE "PushTicket" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateIndex
CREATE INDEX "PushTicket_createdAt_idx" ON "PushTicket"("createdAt");

