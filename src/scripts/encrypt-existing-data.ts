#!/usr/bin/env tsx

/**
 * Migration Script: Encrypt Existing Data
 *
 * This script encrypts all existing unencrypted sensitive data in the database.
 * It's safe to run multiple times as it detects already encrypted data.
 *
 * Usage: npm run encrypt-existing-data
 */

// Load environment variables from .env.local
import * as fs from "fs";
import * as path from "path";

// Load .env.local file manually for scripts
const envPath = path.join(process.cwd(), ".env.local");
if (fs.existsSync(envPath)) {
  const envContent = fs.readFileSync(envPath, "utf8");
  const lines = envContent.split("\n");

  for (const line of lines) {
    const trimmedLine = line.trim();
    if (
      trimmedLine &&
      !trimmedLine.startsWith("#") &&
      trimmedLine.includes("=")
    ) {
      const [key, ...valueParts] = trimmedLine.split("=");
      const value = valueParts.join("=");
      if (key && value && !process.env[key]) {
        process.env[key] = value;
      }
    }
  }
}

import { db } from "../server/db";
import {
  users,
  servers,
  envVars,
  apiTokens,
  systemSettings,
} from "../shared/schema";
import { encryptionService, shouldEncrypt } from "../lib/encryption-service";
import { eq } from "drizzle-orm";

interface MigrationStats {
  usersProcessed: number;
  usersEncrypted: number;
  serversProcessed: number;
  serversEncrypted: number;
  envVarsProcessed: number;
  envVarsEncrypted: number;
  apiTokensProcessed: number;
  apiTokensEncrypted: number;
  settingsProcessed: number;
  settingsEncrypted: number;
}

/**
 * Check if data appears to be already encrypted
 * Encrypted data should be base64 and have minimum length
 */
function isDataEncrypted(data: string): boolean {
  if (!data || data.length < 50) return false;

  // Check if it looks like base64 encoded data
  const base64Regex = /^[A-Za-z0-9+/=]+$/;
  if (!base64Regex.test(data)) return false;

  // Try to decode as base64 to verify format
  try {
    const decoded = Buffer.from(data, "base64");
    // Encrypted data should have minimum size (IV + auth tag + some data)
    return decoded.length >= 50;
  } catch {
    return false;
  }
}

/**
 * Migrate users table - encrypt passwords
 */
async function migrateUsers(): Promise<{
  processed: number;
  encrypted: number;
}> {
  console.log("🔐 Migrating users table...");

  const allUsers = await db.select().from(users);
  let processed = 0;
  let encrypted = 0;

  for (const user of allUsers) {
    processed++;

    if (user.password && !isDataEncrypted(user.password)) {
      try {
        // Hash the password using bcrypt (not encrypt, as passwords should be hashed)
        const hashedPassword = await encryptionService.hashPassword(
          user.password,
        );

        await db
          .update(users)
          .set({ password: hashedPassword })
          .where(eq(users.id, user.id));

        encrypted++;
        console.log(
          `  ✓ Encrypted password for user: ${user.email || user.username || user.id}`,
        );
      } catch (error) {
        console.error(
          `  ✗ Failed to encrypt password for user ${user.id}:`,
          error,
        );
      }
    }
  }

  return { processed, encrypted };
}

/**
 * Migrate servers table - encrypt SSH keys
 */
async function migrateServers(): Promise<{
  processed: number;
  encrypted: number;
}> {
  console.log("🔐 Migrating servers table...");

  const allServers = await db.select().from(servers);
  let processed = 0;
  let encrypted = 0;

  for (const server of allServers) {
    processed++;

    if (server.sshKey && !isDataEncrypted(server.sshKey)) {
      try {
        const encryptedKey = encryptionService.encrypt(server.sshKey);

        await db
          .update(servers)
          .set({ sshKey: encryptedKey })
          .where(eq(servers.id, server.id));

        encrypted++;
        console.log(`  ✓ Encrypted SSH key for server: ${server.name}`);
      } catch (error) {
        console.error(
          `  ✗ Failed to encrypt SSH key for server ${server.id}:`,
          error,
        );
      }
    }
  }

  return { processed, encrypted };
}

/**
 * Migrate environment variables table - encrypt values
 */
async function migrateEnvVars(): Promise<{
  processed: number;
  encrypted: number;
}> {
  console.log("🔐 Migrating environment variables table...");

  const allEnvVars = await db.select().from(envVars);
  let processed = 0;
  let encrypted = 0;

  for (const envVar of allEnvVars) {
    processed++;

    if (envVar.value && !isDataEncrypted(envVar.value)) {
      try {
        const encryptedValue = encryptionService.encrypt(envVar.value);

        await db
          .update(envVars)
          .set({ value: encryptedValue })
          .where(eq(envVars.id, envVar.id));

        encrypted++;
        console.log(
          `  ✓ Encrypted environment variable: ${envVar.key} (Event ID: ${envVar.eventId})`,
        );
      } catch (error) {
        console.error(`  ✗ Failed to encrypt env var ${envVar.id}:`, error);
      }
    }
  }

  return { processed, encrypted };
}

/**
 * Migrate API tokens table - encrypt tokens
 */
async function migrateApiTokens(): Promise<{
  processed: number;
  encrypted: number;
}> {
  console.log("🔐 Migrating API tokens table...");

  const allTokens = await db.select().from(apiTokens);
  let processed = 0;
  let encrypted = 0;

  for (const token of allTokens) {
    processed++;

    if (token.token && !isDataEncrypted(token.token)) {
      try {
        const encryptedToken = encryptionService.encrypt(token.token);

        await db
          .update(apiTokens)
          .set({ token: encryptedToken })
          .where(eq(apiTokens.id, token.id));

        encrypted++;
        console.log(`  ✓ Encrypted API token: ${token.name}`);
      } catch (error) {
        console.error(`  ✗ Failed to encrypt API token ${token.id}:`, error);
      }
    }
  }

  return { processed, encrypted };
}

/**
 * Migrate settings table - encrypt sensitive values
 */
async function migrateSettings(): Promise<{
  processed: number;
  encrypted: number;
}> {
  console.log("🔐 Migrating settings table...");

  const allSettings = await db.select().from(systemSettings);
  let processed = 0;
  let encrypted = 0;

  // List of sensitive settings that should be encrypted
  const sensitiveSettings = [
    "smtp_password",
    "openai_api_key",
    "email_password",
    "api_secret",
    "webhook_secret",
  ];

  for (const setting of allSettings) {
    processed++;

    // Only encrypt settings that are marked as sensitive
    const isSensitive = sensitiveSettings.some((key) =>
      setting.key.toLowerCase().includes(key.toLowerCase()),
    );

    if (isSensitive && setting.value && !isDataEncrypted(setting.value)) {
      try {
        const encryptedValue = encryptionService.encrypt(setting.value);

        await db
          .update(systemSettings)
          .set({ value: encryptedValue })
          .where(eq(systemSettings.key, setting.key));

        encrypted++;
        console.log(`  ✓ Encrypted sensitive setting: ${setting.key}`);
      } catch (error) {
        console.error(`  ✗ Failed to encrypt setting ${setting.key}:`, error);
      }
    }
  }

  return { processed, encrypted };
}

/**
 * Main migration function
 */
async function main() {
  console.log("🚀 Starting data encryption migration...\n");

  const stats: MigrationStats = {
    usersProcessed: 0,
    usersEncrypted: 0,
    serversProcessed: 0,
    serversEncrypted: 0,
    envVarsProcessed: 0,
    envVarsEncrypted: 0,
    apiTokensProcessed: 0,
    apiTokensEncrypted: 0,
    settingsProcessed: 0,
    settingsEncrypted: 0,
  };

  try {
    // Test encryption service first
    console.log("🔧 Testing encryption service...");
    const testData = "test-" + Date.now();
    const encrypted = encryptionService.encrypt(testData);
    const decrypted = encryptionService.decrypt(encrypted);

    if (decrypted !== testData) {
      throw new Error("Encryption service test failed");
    }
    console.log("✅ Encryption service is working correctly\n");

    // Migrate each table
    const userResults = await migrateUsers();
    stats.usersProcessed = userResults.processed;
    stats.usersEncrypted = userResults.encrypted;

    const serverResults = await migrateServers();
    stats.serversProcessed = serverResults.processed;
    stats.serversEncrypted = serverResults.encrypted;

    const envVarResults = await migrateEnvVars();
    stats.envVarsProcessed = envVarResults.processed;
    stats.envVarsEncrypted = envVarResults.encrypted;

    const tokenResults = await migrateApiTokens();
    stats.apiTokensProcessed = tokenResults.processed;
    stats.apiTokensEncrypted = tokenResults.encrypted;

    const settingResults = await migrateSettings();
    stats.settingsProcessed = settingResults.processed;
    stats.settingsEncrypted = settingResults.encrypted;

    // Print summary
    console.log("\n📊 Migration Summary:");
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log(
      `👥 Users:          ${stats.usersEncrypted}/${stats.usersProcessed} encrypted`,
    );
    console.log(
      `🖥️  Servers:        ${stats.serversEncrypted}/${stats.serversProcessed} encrypted`,
    );
    console.log(
      `🔧 Environment Vars: ${stats.envVarsEncrypted}/${stats.envVarsProcessed} encrypted`,
    );
    console.log(
      `🔑 API Tokens:     ${stats.apiTokensEncrypted}/${stats.apiTokensProcessed} encrypted`,
    );
    console.log(
      `⚙️  Settings:       ${stats.settingsEncrypted}/${stats.settingsProcessed} encrypted`,
    );
    console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

    const totalEncrypted =
      stats.usersEncrypted +
      stats.serversEncrypted +
      stats.envVarsEncrypted +
      stats.apiTokensEncrypted +
      stats.settingsEncrypted;
    const totalProcessed =
      stats.usersProcessed +
      stats.serversProcessed +
      stats.envVarsProcessed +
      stats.apiTokensProcessed +
      stats.settingsProcessed;

    console.log(
      `🎉 Total: ${totalEncrypted}/${totalProcessed} records encrypted`,
    );

    if (totalEncrypted === 0) {
      console.log("\n✅ All sensitive data is already encrypted!");
    } else {
      console.log(`\n✅ Successfully encrypted ${totalEncrypted} records!`);
      console.log(
        "⚠️  Remember to backup your ENCRYPTION_KEY environment variable.",
      );
    }
  } catch (error) {
    console.error("\n❌ Migration failed:", error);
    process.exit(1);
  }
}

// Run the migration
main()
  .then(() => {
    console.log("\n🏁 Migration completed successfully!");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n💥 Migration failed with error:", error);
    process.exit(1);
  });
