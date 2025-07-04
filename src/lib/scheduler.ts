/**
 * Scheduler Module
 *
 * This file is an entry point that re-exports the scheduler instance from
 * the modular implementation in the /scheduler directory.
 *
 * The code has been reorganized into smaller, more maintainable modules
 * while preserving the original functionality.
 */

// Re-export the scheduler instance for backward compatibility
export { scheduler } from "./scheduler/index";
