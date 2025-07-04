/**
 * System Template Seeding Service
 *
 * Seeds the database with default system templates on first application run
 * System templates are visible to all users but only editable by admins
 */

import { db } from "@/server/db";
import { templates, ToolType } from "@/shared/schema";
import { defaultTemplates } from "@/lib/default-templates";
import { count } from "drizzle-orm";

export async function seedSystemTemplates(): Promise<void> {
  try {
    console.log("Checking if system templates need seeding...");

    // Check if any templates exist in the database
    const templateCount = await db.select({ count: count() }).from(templates);
    const totalTemplates = templateCount[0]?.count ?? 0;

    if (totalTemplates > 0) {
      console.log(`Found ${totalTemplates} existing templates, skipping seed.`);
      return;
    }

    console.log("No templates found, seeding system templates...");

    // Seed system templates for each tool type
    const systemTemplatesToSeed: {
      userId: null;
      name: string;
      type: ToolType;
      content: string;
      subject: string | null;
      isSystemTemplate: true;
    }[] = [];

    // Email system templates
    const emailTemplates = defaultTemplates.EMAIL ?? [];
    emailTemplates.forEach((template) => {
      systemTemplatesToSeed.push({
        userId: null, // System templates have no owner
        name: template.name,
        type: ToolType.EMAIL,
        content: template.content,
        subject: template.subject ?? null,
        isSystemTemplate: true,
      });
    });

    // Slack system templates
    const slackTemplates = defaultTemplates.SLACK ?? [];
    slackTemplates.forEach((template) => {
      systemTemplatesToSeed.push({
        userId: null,
        name: template.name,
        type: ToolType.SLACK,
        content: template.content,
        subject: null,
        isSystemTemplate: true,
      });
    });

    // Discord system templates
    const discordTemplates = defaultTemplates.DISCORD ?? [];
    discordTemplates.forEach((template) => {
      systemTemplatesToSeed.push({
        userId: null,
        name: template.name,
        type: ToolType.DISCORD,
        content: template.content,
        subject: null,
        isSystemTemplate: true,
      });
    });

    if (systemTemplatesToSeed.length > 0) {
      await db.insert(templates).values(systemTemplatesToSeed);
      console.log(
        `Successfully seeded ${systemTemplatesToSeed.length} system templates`,
      );
    }
  } catch (error) {
    console.error("Error seeding system templates:", error);
    throw error;
  }
}

/**
 * Initialize system templates on application startup
 * This should be called when the application starts
 */
export async function initializeSystemTemplates(): Promise<void> {
  try {
    await seedSystemTemplates();
  } catch (error) {
    console.error("Failed to initialize system templates:", error);
    // Don't throw - allow application to continue even if seeding fails
  }
}
