#!/usr/bin/env tsx

import * as fs from "fs";
import * as path from "path";

// Priority files that should have error logging
const PRIORITY_FILES = [
  // API routes
  "/src/app/api/admin/terminal/route.ts",
  "/src/app/api/internal/servers/[serverId]/credentials/route.ts",

  // Server-side critical
  "/src/server/storage.ts",
  "/src/server/utils/event-validation.ts",
  "/src/server/api/routers/tools.ts",

  // Security-sensitive
  "/src/lib/ssh.ts",
  "/src/lib/rate-limit-service.ts",
  "/src/lib/encryption-service.ts",
  "/src/lib/oauth/OAuthFlow.ts",
  "/src/lib/oauth/TokenManager.ts",

  // Core functionality
  "/src/hooks/useOptimisticUpdate.ts",
  "/src/components/event-details/EventDetails.tsx",
  "/src/components/event-list/EventsList.tsx",
  "/src/components/workflows/WorkflowList.tsx",
];

// Files where empty catches are acceptable (e.g., cleanup operations)
const ACCEPTABLE_EMPTY_CATCHES = [
  // Test files
  "test.tsx",
  "test.ts",
  ".test.",

  // Specific cleanup patterns
  "dispose",
  "cleanup",
  "teardown",
];

function shouldSkipFile(filePath: string): boolean {
  return ACCEPTABLE_EMPTY_CATCHES.some((pattern) => filePath.includes(pattern));
}

function findEmptyCatches(
  content: string,
): Array<{ line: number; type: string }> {
  const lines = content.split("\n");
  const results: Array<{ line: number; type: string }> = [];

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line) continue;

    const nextLine = lines[i + 1] ?? "";

    // Pattern 1: } catch {
    if (line.includes("} catch {")) {
      results.push({ line: i + 1, type: "no-param" });
    }

    // Pattern 2: } catch (something) { }
    if (line.includes("} catch (") && line.includes(") {")) {
      // Check if it's empty (only spaces or closing brace on same line)
      if (line.includes(") { }") || nextLine.trim() === "}") {
        results.push({ line: i + 1, type: "with-param" });
      }
    }

    // Pattern 3: catch on one line, empty block below
    if (/^} catch \(.*\) {$/.exec(line.trim()) || line.trim() === "} catch {") {
      // Check if next non-comment line is just a closing brace
      let j = i + 1;
      while (
        j < lines.length &&
        lines[j] !== undefined &&
        (lines[j]!.trim() === "" || lines[j]!.trim().startsWith("//"))
      ) {
        j++;
      }
      if (j < lines.length && lines[j]?.trim() === "}") {
        results.push({ line: i + 1, type: "multi-line" });
      }
    }
  }

  return results;
}

// Main execution
const projectRoot = path.resolve(__dirname, "../..");

console.log("Analyzing empty catch blocks in priority files...\n");

let totalEmptyCatches = 0;
let criticalEmptyCatches = 0;

for (const file of PRIORITY_FILES) {
  const fullPath = path.join(projectRoot, file);

  if (!fs.existsSync(fullPath)) {
    console.log(`⚠️  File not found: ${file}`);
    continue;
  }

  const content = fs.readFileSync(fullPath, "utf-8");
  const emptyCatches = findEmptyCatches(content);

  if (emptyCatches.length > 0) {
    console.log(`📄 ${file}`);
    console.log(`   Found ${emptyCatches.length} empty catch blocks:`);

    for (const catch_ of emptyCatches) {
      console.log(`   - Line ${catch_.line} (${catch_.type})`);
      totalEmptyCatches++;

      if (!shouldSkipFile(file)) {
        criticalEmptyCatches++;
      }
    }
    console.log("");
  }
}

console.log("\n📊 Summary:");
console.log(`Total empty catch blocks in priority files: ${totalEmptyCatches}`);
console.log(
  `Critical catches requiring error logging: ${criticalEmptyCatches}`,
);

console.log("\n💡 Recommendations:");
console.log("1. Add console.error() to all critical empty catch blocks");
console.log("2. Include context about what operation failed");
console.log(
  "3. For cleanup operations, add a comment explaining why errors are ignored",
);
console.log("4. Consider using a centralized error logging service");
