import { ScriptScheduler } from "./scheduler";

// Create a single global instance of the scheduler with a more robust singleton pattern
let globalSchedulerInstance: ScriptScheduler | null = null;
let isCreating = false;

// Get or create the scheduler instance
function getSchedulerInstance(): ScriptScheduler {
  if (!globalSchedulerInstance && !isCreating) {
    isCreating = true;
    console.log("Creating new global scheduler instance");
    globalSchedulerInstance = new ScriptScheduler();
    isCreating = false;
  }
  return globalSchedulerInstance!;
}

// Export a singleton instance (without auto-initialization)
export const scheduler = getSchedulerInstance();

// Re-export the class for type usage
export { ScriptScheduler } from "./scheduler";
