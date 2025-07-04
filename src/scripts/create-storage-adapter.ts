/**
 * Create a transitional storage adapter to support the table renames
 * from scripts → events and events → conditional_events
 * 
 * This file will help us handle the transition smoothly by providing
 * compatibility methods.
 */

import { db } from "../server/db";
import { sql } from "drizzle-orm";

/**
 * Create a transitional database storage adapter that will map
 * old column names to new column names and vice versa.
 */
const createStorageAdapter = () => {
  return {
    /**
     * Map scriptId references to eventId
     */
    mapScriptIdToEventId: async () => {
      // Update logs table
      const logsResult = await db.execute(sql`
        UPDATE "logs" SET "event_id" = "script_id"
        WHERE "event_id" IS NULL AND "script_id" IS NOT NULL
      `);
      console.log(`Updated ${logsResult.rowCount} rows in logs table`);

      // Update env_vars table
      const envVarsResult = await db.execute(sql`
        UPDATE "env_vars" SET "event_id" = "script_id"
        WHERE "event_id" IS NULL AND "script_id" IS NOT NULL
      `);
      console.log(`Updated ${envVarsResult.rowCount} rows in env_vars table`);

      // Update workflow_nodes table
      const workflowNodesResult = await db.execute(sql`
        UPDATE "workflow_nodes" SET "event_id" = "script_id"
        WHERE "event_id" IS NULL AND "script_id" IS NOT NULL
      `);
      console.log(`Updated ${workflowNodesResult.rowCount} rows in workflow_nodes table`);

      // Update conditional_events table (previously events)
      const conditionalEventsResult = await db.execute(sql`
        UPDATE "conditional_events" 
        SET 
          "success_event_id" = "success_script_id",
          "fail_event_id" = "fail_script_id",
          "target_event_id" = "target_script_id"
        WHERE 
          ("success_event_id" IS NULL AND "success_script_id" IS NOT NULL) OR
          ("fail_event_id" IS NULL AND "fail_script_id" IS NOT NULL) OR
          ("target_event_id" IS NULL AND "target_script_id" IS NOT NULL)
      `);
      console.log(`Updated ${conditionalEventsResult.rowCount} rows in conditional_events table`);
    },

    /**
     * Create view aliases to make the transition smoother
     */
    createViewAliases: async () => {
      // Create a view to alias events as scripts
      await db.execute(sql`
        CREATE OR REPLACE VIEW "scripts" AS
        SELECT * FROM "events"
      `);
      console.log('Created scripts view');

      // Create a view to alias conditional_events as events
      await db.execute(sql`
        CREATE OR REPLACE VIEW "events_old" AS
        SELECT * FROM "conditional_events"
      `);
      console.log('Created events_old view');
    },

    /**
     * Drop the view aliases when no longer needed
     */
    dropViewAliases: async () => {
      await db.execute(sql`DROP VIEW IF EXISTS "scripts"`);
      await db.execute(sql`DROP VIEW IF EXISTS "events_old"`);
      console.log('Dropped view aliases');
    }
  };
};

export const storageAdapter = createStorageAdapter();

// When run directly
if (require.main === module) {
  const action = process.argv[2];
  
  switch (action) {
    case 'map-ids':
      storageAdapter.mapScriptIdToEventId()
        .then(() => {
          console.log('Successfully mapped IDs from old column names to new ones');
          process.exit(0);
        })
        .catch(error => {
          console.error('Error mapping IDs:', error);
          process.exit(1);
        });
      break;
      
    case 'create-views':
      storageAdapter.createViewAliases()
        .then(() => {
          console.log('Successfully created view aliases for backwards compatibility');
          process.exit(0);
        })
        .catch(error => {
          console.error('Error creating view aliases:', error);
          process.exit(1);
        });
      break;
      
    case 'drop-views':
      storageAdapter.dropViewAliases()
        .then(() => {
          console.log('Successfully dropped view aliases');
          process.exit(0);
        })
        .catch(error => {
          console.error('Error dropping view aliases:', error);
          process.exit(1);
        });
      break;
      
    default:
      console.log(`
Usage: 
  npx tsx scripts/create-storage-adapter.ts map-ids
  npx tsx scripts/create-storage-adapter.ts create-views
  npx tsx scripts/create-storage-adapter.ts drop-views
      `);
      process.exit(1);
  }
}