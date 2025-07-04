/**
 * Script to initialize the script scheduler
 */
import { scheduler } from "../lib/scheduler";

async function initializeScheduler() {
  try {
    console.log("Initializing script scheduler...");
    await scheduler.initialize();
    console.log("Script scheduler initialized successfully");
  } catch (error) {
    console.error("Failed to initialize script scheduler:", error);
    throw error;
  }
}

// Run the initialization if this script is executed directly
if (require.main === module) {
  initializeScheduler().catch((err) => {
    console.error("Scheduler initialization failed:", err);
    process.exit(1);
  });
}

export { initializeScheduler };
