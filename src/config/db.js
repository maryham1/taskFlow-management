import { PrismaClient } from "@prisma/client";
const prisma = new PrismaClient({
  log:
    process.env.NODE_ENV === "development"
      ? ["query", "error", "warn"]
      : ["error"],
});

const connectDB = async () => {
  try {
    await prisma.$connect();
    console.log("database succefully connected");
  } catch (error) {
    console.error(`Database connection error ${error.message}`);
    process.exit(1);
  }
};

const disconnectDB = async () => {
  await prisma.$disconnect();
};

export { prisma, disconnectDB, connectDB };
