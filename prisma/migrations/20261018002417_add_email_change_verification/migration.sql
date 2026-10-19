-- AlterEnum
ALTER TYPE "VerificationCodeType" ADD VALUE 'EMAIL_CHANGE';

-- AlterTable
ALTER TABLE "VerificationCode" ADD COLUMN     "pendingEmail" TEXT;
