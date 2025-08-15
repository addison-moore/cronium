import { ScriptScheduler } from "./scheduler";

// Store singleton on global to persist across hot reloads in development
declare global {
  var __scheduler: ScriptScheduler | undefined;
}

// Get or create the scheduler instance
function getSchedulerInstance(): ScriptScheduler {
  if (!global.__scheduler) {
    console.log("Creating new global scheduler instance");
    global.__scheduler = new ScriptScheduler();
  }
  return global.__scheduler;
}

// Export a singleton instance (without auto-initialization)
export const scheduler = getSchedulerInstance();

// Re-export the class for type usage
export { ScriptScheduler } from "./scheduler";
