/**
 * DEPRECATED: This migration script is no longer needed.
 * The templates table has been removed from the schema and the migration
 * to tool action templates has been completed.
 *
 * This file is kept for historical reference only.
 *
 * Original purpose:
 * Migration script to convert old templates to new tool action templates
 */

console.log("DEPRECATED: This migration script is no longer needed.");
console.log("The templates table has been removed and migration is complete.");
console.log("This file is kept for historical reference only.");

// Prevent accidental execution
process.exit(0);

/* ORIGINAL CODE COMMENTED OUT - NO LONGER FUNCTIONAL

import { db } from "@/server/db";
import { templates, toolActionTemplates } from "@/shared/schema";
import { eq } from "drizzle-orm";
import * as dotenv from "dotenv";

// Load environment variables
dotenv.config();

// Mapping from old template types to new tool types and action IDs
const TEMPLATE_TYPE_MAPPING = {
  DISCORD: {
    toolType: "DISCORD",
    actionId: "discord-send-message",
  },
  SLACK: {
    toolType: "SLACK",
    actionId: "slack-send-message",
  },
  EMAIL: {
    toolType: "EMAIL",
    actionId: "send-email",
  },
} as const;

async function migrateTemplates() {
  console.log("Starting template migration...");

  try {
    // 1. Fetch all existing templates
    const existingTemplates = await db.select().from(templates);
    console.log(`Found ${existingTemplates.length} templates to migrate`);

    // 2. Track migration results
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    // 3. Process each template
    for (const template of existingTemplates) {
      try {
        // Skip if template type is not supported
        if (
          !TEMPLATE_TYPE_MAPPING[
            template.type as keyof typeof TEMPLATE_TYPE_MAPPING
          ]
        ) {
          console.warn(
            `Skipping template ${template.id} with unsupported type: ${template.type}`,
          );
          skipped++;
          continue;
        }

        const mapping =
          TEMPLATE_TYPE_MAPPING[
            template.type as keyof typeof TEMPLATE_TYPE_MAPPING
          ];

        // Prepare parameters based on template type
        let parameters: Record<string, unknown> = {};

        if (template.type === "DISCORD" || template.type === "SLACK") {
          parameters = {
            content: template.content,
          };
        } else if (template.type === "EMAIL") {
          parameters = {
            to: "{{cronium.user.adminEmail}}", // Placeholder - users will need to update
            subject: template.subject || "Cronium Notification",
            body: template.content,
          };
        }

        // Check if already migrated
        const existingMigrated = await db
          .select()
          .from(toolActionTemplates)
          .where(eq(toolActionTemplates.name, `[Migrated] ${template.name}`));

        if (existingMigrated.length > 0) {
          console.log(
            `Template "${template.name}" already migrated, skipping...`,
          );
          skipped++;
          continue;
        }

        // Insert into new table
        await db.insert(toolActionTemplates).values({
          userId: template.userId,
          name: `[Migrated] ${template.name}`,
          description: `Migrated from old template system. Original type: ${template.type}`,
          toolType: mapping.toolType,
          actionId: mapping.actionId,
          parameters,
          isSystemTemplate: template.isSystemTemplate,
          createdAt: template.createdAt,
          updatedAt: new Date(),
        });

        console.log(`✓ Migrated template: ${template.name}`);
        migrated++;
      } catch (error) {
        console.error(`✗ Error migrating template ${template.id}:`, error);
        errors++;
      }
    }

    // 4. Summary
    console.log("\n=== Migration Summary ===");
    console.log(`Total templates: ${existingTemplates.length}`);
    console.log(`Successfully migrated: ${migrated}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Errors: ${errors}`);

    // 5. Note about manual steps
    if (migrated > 0) {
      console.log("\n⚠️  Important Notes:");
      console.log(
        "1. Migrated templates are prefixed with '[Migrated]' to distinguish them",
      );
      console.log(
        "2. Email templates have a placeholder 'to' address that users need to update",
      );
      console.log(
        "3. Review migrated templates to ensure they work with the new system",
      );
      console.log(
        "4. The old templates table has NOT been modified - manual cleanup required",
      );
      console.log(
        "5. Update ConditionalActionsSection component to use new templates",
      );
    }
  } catch (error) {
    console.error("Fatal error during migration:", error);
    process.exit(1);
  }
}

// Run migration if this file is executed directly
if (require.main === module) {
  migrateTemplates()
    .then(() => {
      console.log("\nMigration completed!");
      process.exit(0);
    })
    .catch((error) => {
      console.error("\nMigration failed:", error);
      process.exit(1);
    });
}

export { migrateTemplates };

*/
