-- AlterTable
ALTER TABLE "Task" ADD COLUMN     "endDate" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "Task_userId_endDate_idx" ON "Task"("userId", "endDate");
