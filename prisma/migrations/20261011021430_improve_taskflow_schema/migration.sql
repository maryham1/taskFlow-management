/*
  Warnings:

  - You are about to drop the column `countryCode` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `firstLoginCompleted` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `phone` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `timezone` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `whatsappReminders` on the `UserPreference` table. All the data in the column will be lost.
  - You are about to drop the `WhatsAppMessage` table. If the table is not empty, all the data it contains will be lost.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ReminderType" ADD VALUE 'TWO_YEARS';
ALTER TYPE "ReminderType" ADD VALUE 'ONE_YEAR';

-- DropForeignKey
ALTER TABLE "WhatsAppMessage" DROP CONSTRAINT "WhatsAppMessage_taskId_fkey";

-- DropForeignKey
ALTER TABLE "WhatsAppMessage" DROP CONSTRAINT "WhatsAppMessage_userId_fkey";

-- DropIndex
DROP INDEX "DailyReminderDelivery_status_idx";

-- DropIndex
DROP INDEX "Notification_userId_idx";

-- DropIndex
DROP INDEX "Reminder_remindAt_status_idx";

-- DropIndex
DROP INDEX "User_phone_key";

-- DropIndex
DROP INDEX "VerificationCode_userId_idx";

-- AlterTable
ALTER TABLE "User" DROP COLUMN "countryCode",
DROP COLUMN "firstLoginCompleted",
DROP COLUMN "phone",
DROP COLUMN "timezone",
ADD COLUMN     "termsAcceptedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "UserPreference" DROP COLUMN "whatsappReminders",
ADD COLUMN     "timezone" TEXT NOT NULL DEFAULT 'UTC';

-- AlterTable
ALTER TABLE "VerificationCode" ADD COLUMN     "attempts" INTEGER NOT NULL DEFAULT 0;

-- DropTable
DROP TABLE "WhatsAppMessage";

-- DropEnum
DROP TYPE "WhatsAppMessageStatus";

-- DropEnum
DROP TYPE "WhatsAppMessageType";

-- CreateIndex
CREATE INDEX "DailyReminderDelivery_status_lastAttemptAt_idx" ON "DailyReminderDelivery"("status", "lastAttemptAt");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "Notification"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_type_idx" ON "Notification"("userId", "type");

-- CreateIndex
CREATE INDEX "Reminder_status_remindAt_idx" ON "Reminder"("status", "remindAt");

-- CreateIndex
CREATE INDEX "Task_userId_status_dueDate_idx" ON "Task"("userId", "status", "dueDate");

-- CreateIndex
CREATE INDEX "VerificationCode_userId_type_used_idx" ON "VerificationCode"("userId", "type", "used");
