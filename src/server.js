import "dotenv/config";

import app from "./app.js";

import { connectDB, disconnectDB } from "./config/db.js";

import { startReminderJob } from "./jobs/reminderJob.js";
import { startDailyReminderJob } from "./jobs/dailyReminderJob.js";

const PORT = process.env.PORT || 5000;

const startServer = async () => {
  try {
    await connectDB();

    startReminderJob();
    startDailyReminderJob();

    const server = app.listen(PORT, () => {
      console.log(`TaskFlow API running on port ${PORT}`);
    });

    const shutdown = async (signal) => {
      console.log(`${signal} received`);

      server.close(async () => {
        await disconnectDB();
        process.exit(0);
      });
    };

    process.on("SIGTERM", () => {
      shutdown("SIGTERM");
    });

    process.on("SIGINT", () => {
      shutdown("SIGINT");
    });
  } catch (error) {
    console.error("Failed to start server:", error);

    await disconnectDB();

    process.exit(1);
  }
};

startServer();
