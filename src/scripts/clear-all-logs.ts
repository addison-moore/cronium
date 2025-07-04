/**
 * This script will clear all logs from the database
 * It provides options to clear logs by:
 * - All logs: no arguments
 * - A specific event/script: --event <eventId>
 * - Logs older than a certain date: --older-than <days>
 */

import { db } from '@/server/db';
import { logs } from '@/shared/schema';
import { eq, lt } from 'drizzle-orm';

/**
 * Deletes all logs from the database
 */
async function clearAllLogs() {
  try {
    console.log('Starting log cleanup process...');
    
    // For safety, first count the logs (approximate)
    // We use SQL directly to avoid any potential issues with the storage adapter
    const countResult = await db.execute(
      sql`SELECT COUNT(*) FROM logs`
    );
    const countValue = countResult.rows?.[0]?.count;
    const logCount = typeof countValue === 'string' ? parseInt(countValue, 10) : 0;
    
    // Delete all logs using direct db deletion
    await db.delete(logs);
    
    console.log(`Successfully deleted approximately ${logCount} logs from the database.`);
    console.log(`Operation complete.`);
    
    return { success: true, message: `All logs have been deleted (approximately ${logCount} total).` };
  } catch (error) {
    console.error('Error clearing logs:', error);
    return { success: false, message: `Failed to clear logs: ${error}` };
  }
}

/**
 * Deletes logs for a specific event
 */
async function clearEventLogs(eventId: number) {
  try {
    // Check if the event exists first
    const eventExists = await db.execute(
      sql`SELECT COUNT(*) FROM events WHERE id = ${eventId}`
    );
    const countResult = eventExists.rows?.[0] as { count?: string } | undefined;
    const eventCount = parseInt(countResult?.count || '0', 10);
    
    if (eventCount === 0) {
      console.warn(`Warning: Event ${eventId} does not exist in the database.`);
      // Continue anyway as we might want to clean orphaned logs
    }
    
    // Count logs for this event first
    const logCountQuery = await db.execute(
      sql`SELECT COUNT(*) FROM logs WHERE event_id = ${eventId}`
    );
    const logCountResult = logCountQuery.rows?.[0] as { count?: string } | undefined;
    const logCount = parseInt(logCountResult?.count || '0', 10);
    
    if (logCount === 0) {
      console.log(`No logs found for event/script ID ${eventId}.`);
      return { success: true, message: 'No logs to delete.' };
    }
    
    // Delete logs for this specific event
    await db.delete(logs).where(eq(logs.eventId, eventId));
    
    console.log(`Successfully deleted ${logCount} logs for event/script ID ${eventId}.`);
    return { success: true, message: `Deleted ${logCount} logs for event/script ID ${eventId}.` };
  } catch (error) {
    console.error(`Error clearing logs for event ${eventId}:`, error);
    return { success: false, message: `Failed to clear logs: ${error}` };
  }
}

/**
 * Deletes logs older than the specified number of days
 */
async function clearOldLogs(daysAgo: number) {
  try {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysAgo);
    
    // Count logs older than cutoff date
    const countResult = await db.execute(
      sql`SELECT COUNT(*) FROM logs WHERE start_time < ${cutoffDate.toISOString()}`
    );
    const countValue = countResult.rows?.[0]?.count;
    const logCount = typeof countValue === 'string' ? parseInt(countValue, 10) : 0;
    
    if (logCount === 0) {
      console.log(`No logs found older than ${daysAgo} days (${cutoffDate.toISOString()}).`);
      return { success: true, message: 'No logs to delete.' };
    }
    
    // Delete logs older than the cutoff date
    await db.delete(logs).where(lt(logs.startTime, cutoffDate));
    
    console.log(`Successfully deleted ${logCount} logs older than ${daysAgo} days.`);
    return { success: true, message: `Deleted ${logCount} logs older than ${daysAgo} days.` };
  } catch (error) {
    console.error(`Error clearing logs older than ${daysAgo} days:`, error);
    return { success: false, message: `Failed to clear logs: ${error}` };
  }
}

/**
 * Main function that handles command line arguments
 */
async function main() {
  const args = process.argv.slice(2);
  
  try {
    // Default is to clear all logs
    if (args.length === 0) {
      console.log('No arguments provided. Clearing all logs...');
      const result = await clearAllLogs();
      console.log(result.message);
      process.exit(result.success ? 0 : 1);
    }
    
    // Handle specific script/event ID
    if (args[0] === '--event' || args[0] === '--script') {
      if (args.length < 2) {
        console.error('Missing event ID. Usage: --event <id>');
        process.exit(1);
      }
      
      const eventIdArg = args[1];
      if (!eventIdArg) {
        console.error('Missing event ID');
        process.exit(1);
      }
      const eventId = parseInt(eventIdArg, 10);
      if (isNaN(eventId)) {
        console.error('Invalid event ID. Please provide a valid number.');
        process.exit(1);
      }
      
      const result = await clearEventLogs(eventId);
      console.log(result.message);
      process.exit(result.success ? 0 : 1);
    }
    
    // Handle logs older than a specific date
    if (args[0] === '--older-than') {
      if (args.length < 2) {
        console.error('Missing days parameter. Usage: --older-than <days>');
        process.exit(1);
      }
      
      const daysArg = args[1];
      if (!daysArg) {
        console.error('Missing days parameter');
        process.exit(1);
      }
      const daysAgo = parseInt(daysArg, 10);
      if (isNaN(daysAgo) || daysAgo <= 0) {
        console.error('Invalid days parameter. Please provide a positive number.');
        process.exit(1);
      }
      
      const result = await clearOldLogs(daysAgo);
      console.log(result.message);
      process.exit(result.success ? 0 : 1);
    }
    
    // If we get here, the arguments were invalid
    console.log('Invalid arguments. Usage:');
    console.log('npx tsx scripts/clear-all-logs.ts                   - Clear all logs');
    console.log('npx tsx scripts/clear-all-logs.ts --event <id>      - Clear logs for specific event');
    console.log('npx tsx scripts/clear-all-logs.ts --older-than <days> - Clear logs older than specified days');
    process.exit(1);
  } catch (error) {
    console.error('Unexpected error:', error);
    process.exit(1);
  }
}

// Import SQL for direct database queries
import { sql } from 'drizzle-orm';

// Run the script
main();