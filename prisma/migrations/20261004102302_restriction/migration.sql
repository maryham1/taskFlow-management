/*
  Warnings:

  - Added the required column `countryCode` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "TaskCompletionMode" AS ENUM ('STRICT', 'FLEXIBLE');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "countryCode" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "UserPreference" ADD COLUMN     "alarmReminders" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "completionMode" "TaskCompletionMode" NOT NULL DEFAULT 'STRICT';
