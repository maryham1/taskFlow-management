-- AlterTable
ALTER TABLE "Task" ALTER COLUMN "description" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "Task_userId_dueDate_idx" ON "Task"("userId", "dueDate");
