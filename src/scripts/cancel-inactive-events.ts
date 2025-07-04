/**
 * This script will force cancel any inactive events that might still be
 * running in the scheduler. It directly interacts with both the database
 * and the scheduler to ensure a clean state.
 */

import { db } from "../server/db";
import { events, EventStatus } from "../shared/schema";
import { eq, ne } from "drizzle-orm";
import { scheduler } from "../lib/scheduler";

async function cancelInactiveEvents() {
  console.log("Checking for inactive events that need cancellation");
  
  try {
    // Find all inactive events
    const inactiveEvents = await db.query.events.findMany({
      where: ne(events.status, EventStatus.ACTIVE),
      columns: { 
        id: true,
        name: true,
        status: true
      }
    });
    
    console.log(`Found ${inactiveEvents.length} inactive events to check`);
    
    // Force cancel each one in the scheduler
    for (const event of inactiveEvents) {
      const schedulerInstance = scheduler as any;
      
      if (schedulerInstance.jobs.has(event.id)) {
        console.log(`Cancelling inactive event ${event.id} (${event.name}) in scheduler`);
        
        // Cancel the job
        schedulerInstance.jobs.get(event.id)?.cancel();
        schedulerInstance.jobs.delete(event.id);
        
        // Remove from tracking
        schedulerInstance.executingEvents.delete(event.id);
        schedulerInstance.lastExecutionTimes.delete(event.id);
        
        // Also clear any nextRunAt in database
        await db.update(events)
          .set({ nextRunAt: null })
          .where(eq(events.id, event.id));
          
        console.log(`Successfully cancelled inactive event ${event.id}`);
      } else {
        console.log(`Event ${event.id} (${event.name}) is already not scheduled`);
      }
    }
    
  } catch (error) {
    console.error(`Error cancelling inactive events:`, error);
  }
}

// Run the function immediately
cancelInactiveEvents()
  .then(() => console.log("Finished cancelling inactive events"))
  .catch(error => console.error("Failed to cancel inactive events:", error));