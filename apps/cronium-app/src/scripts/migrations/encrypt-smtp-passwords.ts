#!/usr/bin/env tsx
/**
 * Migration script to encrypt existing SMTP passwords in the database
 * This script should be run once to migrate unencrypted passwords to encrypted format
 */

import { db } from "@/server/db";
import { systemSettings } from "@/shared/schema";
import { eq } from "drizzle-orm";
import {
  encryptionService,
  isSystemSettingSensitive,
} from "@/lib/encryption-service";

async function encryptExistingSmtpPasswords() {
  console.log("Starting migration to encrypt SMTP passwords...");

  try {
    // Get all sensitive system settings that need encryption
    const sensitiveKeys = ["smtpPassword", "openaiApiKey"];

    for (const key of sensitiveKeys) {
      console.log(`Processing ${key}...`);

      // Get the current setting
      const [setting] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, key));

      if (!setting) {
        console.log(`  No ${key} setting found, skipping...`);
        continue;
      }

      // Check if the value is already encrypted (base64 pattern check)
      const value = setting.value;
      const isEncrypted = value.length >= 50 && /^[A-Za-z0-9+/=]+$/.test(value);

      if (isEncrypted) {
        console.log(`  ${key} appears to be already encrypted, skipping...`);
        continue;
      }

      // Encrypt the value
      const encryptedValue = encryptionService.encrypt(value);

      // Update the database
      await db
        .update(systemSettings)
        .set({
          value: encryptedValue,
          updatedAt: new Date(),
        })
        .where(eq(systemSettings.key, key));

      console.log(`  ✓ ${key} encrypted successfully`);
    }

    console.log("\nMigration completed successfully!");

    // Verify the migration
    console.log("\nVerifying migration...");
    for (const key of sensitiveKeys) {
      const [setting] = await db
        .select()
        .from(systemSettings)
        .where(eq(systemSettings.key, key));

      if (setting) {
        try {
          // Try to decrypt to verify it works
          const decrypted = encryptionService.decrypt(setting.value);
          console.log(`  ✓ ${key} can be decrypted successfully`);
        } catch (error) {
          console.error(`  ✗ Error decrypting ${key}:`, error);
        }
      }
    }
  } catch (error) {
    console.error("Migration failed:", error);
    process.exit(1);
  }
}

// Run the migration
encryptExistingSmtpPasswords()
  .then(() => {
    console.log("\nMigration script completed");
    process.exit(0);
  })
  .catch((error) => {
    console.error("Unexpected error:", error);
    process.exit(1);
  });
