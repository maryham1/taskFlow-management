/*
  Warnings:

  - You are about to drop the column `sent` on the `Reminder` table. All the data in the column will be lost.
  - A unique constraint covering the columns `[taskId,type]` on the table `Reminder` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `updatedAt` to the `Reminder` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "ReminderStatus" AS ENUM ('PENDING', 'PROCESSING', 'SENT', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'READ', 'FAILED');

-- CreateEnum
CREATE TYPE "WhatsAppMessageType" AS ENUM ('REGISTRATION', 'FIRST_LOGIN', 'TASK_REMINDER', 'DAILY_REMINDER');

-- DropIndex
DROP INDEX "Reminder_remindAt_sent_idx";

-- AlterTable
ALTER TABLE "Reminder" DROP COLUMN "sent",
ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "failedAt" TIMESTAMP(3),
ADD COLUMN     "failureReason" TEXT,
ADD COLUMN     "lastAttemptAt" TIMESTAMP(3),
ADD COLUMN     "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL;

-- CreateTable
CREATE TABLE "DailyReminderDelivery" (
    "id" TEXT NOT NULL,
    "localDate" TEXT NOT NULL,
    "status" "ReminderStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "failureReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,

    CONSTRAINT "DailyReminderDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WhatsAppMessage" (
    "id" TEXT NOT NULL,
    "metaMessageId" TEXT,
    "type" "WhatsAppMessageType" NOT NULL,
    "status" "WhatsAppMessageStatus" NOT NULL DEFAULT 'QUEUED',
    "recipient" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "failureCode" TEXT,
    "failureReason" TEXT,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "readAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" TEXT NOT NULL,
    "taskId" TEXT,

    CONSTRAINT "WhatsAppMessage_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DailyReminderDelivery_status_idx" ON "DailyReminderDelivery"("status");

-- CreateIndex
CREATE UNIQUE INDEX "DailyReminderDelivery_userId_localDate_key" ON "DailyReminderDelivery"("userId", "localDate");

-- CreateIndex
CREATE UNIQUE INDEX "WhatsAppMessage_metaMessageId_key" ON "WhatsAppMessage"("metaMessageId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_userId_idx" ON "WhatsAppMessage"("userId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_taskId_idx" ON "WhatsAppMessage"("taskId");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_status_idx" ON "WhatsAppMessage"("status");

-- CreateIndex
CREATE INDEX "WhatsAppMessage_createdAt_idx" ON "WhatsAppMessage"("createdAt");

-- CreateIndex
CREATE INDEX "Reminder_remindAt_status_idx" ON "Reminder"("remindAt", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Reminder_taskId_type_key" ON "Reminder"("taskId", "type");

-- AddForeignKey
ALTER TABLE "DailyReminderDelivery" ADD CONSTRAINT "DailyReminderDelivery_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WhatsAppMessage" ADD CONSTRAINT "WhatsAppMessage_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;
