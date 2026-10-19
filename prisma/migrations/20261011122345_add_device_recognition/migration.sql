-- CreateTable
CREATE TABLE "DeviceRecognition" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DeviceRecognition_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DeviceRecognition_tokenHash_key" ON "DeviceRecognition"("tokenHash");

-- CreateIndex
CREATE INDEX "DeviceRecognition_userId_idx" ON "DeviceRecognition"("userId");

-- AddForeignKey
ALTER TABLE "DeviceRecognition" ADD CONSTRAINT "DeviceRecognition_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
