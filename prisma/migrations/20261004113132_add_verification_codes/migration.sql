/*
  Warnings:

  - You are about to drop the column `emailReminders` on the `UserPreference` table. All the data in the column will be lost.
  - Added the required column `timezone` to the `User` table without a default value. This is not possible if the table is not empty.

*/
-- CreateEnum
CREATE TYPE "VerificationCodeType" AS ENUM ('EMAIL_VERIFICATION', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "firstLoginCompleted" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "timezone" TEXT NOT NULL;

-- AlterTable
ALTER TABLE "UserPreference" DROP COLUMN "emailReminders",
ALTER COLUMN "whatsappReminders" SET DEFAULT true;

-- CreateTable
CREATE TABLE "VerificationCode" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "type" "VerificationCodeType" NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "used" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userId" TEXT NOT NULL,

    CONSTRAINT "VerificationCode_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationCode_userId_idx" ON "VerificationCode"("userId");

-- CreateIndex
CREATE INDEX "VerificationCode_expiresAt_idx" ON "VerificationCode"("expiresAt");

-- AddForeignKey
ALTER TABLE "VerificationCode" ADD CONSTRAINT "VerificationCode_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
