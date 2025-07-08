#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const readline = require("readline");

// Configuration
const CONFIG = {
  maxConcurrentAgents: 5, // Maximum number of agents running simultaneously
  lintLogPath: "lint.log",
  verbose: true,
};

// Parse lint.log and group errors by file
async function parseLintLog(logPath) {
  const fileErrors = new Map();
  const fileStream = fs.createReadStream(logPath);
  const rl = readline.createInterface({
    input: fileStream,
    crlfDelay: Infinity,
  });

  let currentFile = null;
  const filePattern = /^\.\/(.+)$/;
  const errorPattern =
    /^(\d+):(\d+)\s+(Error|Warning):\s+(.+)\s+(@[\w-]+\/[\w-]+)$/;

  for await (const line of rl) {
    const fileMatch = line.match(filePattern);
    if (fileMatch) {
      currentFile = fileMatch[1];
      if (!fileErrors.has(currentFile)) {
        fileErrors.set(currentFile, []);
      }
    } else if (currentFile && errorPattern.test(line)) {
      const match = line.match(errorPattern);
      if (match) {
        fileErrors.get(currentFile).push({
          line: parseInt(match[1]),
          column: parseInt(match[2]),
          severity: match[3],
          message: match[4],
          rule: match[5],
          raw: line,
        });
      }
    }
  }

  return fileErrors;
}

// Create agent task for fixing a specific file
function createAgentTask(filePath, errors) {
  const errorsSummary = errors
    .map((e) => `Line ${e.line}: ${e.severity} - ${e.message} (${e.rule})`)
    .join("\\n");

  const prompt = `Fix the following linting errors in ${filePath}:

${errorsSummary}

Please fix all the listed issues. Focus on:
1. Remove unused imports/variables (prefix with _ if needed)
2. Fix unbound method issues (use arrow functions or add this: void)
3. Fix unsafe assignments and member access (add proper types)
4. Address any other linting errors shown

Make sure the fixes are correct and don't break the code functionality.`;

  return {
    filePath,
    errors,
    prompt,
  };
}

// Execute agent task using Claude Code CLI
async function executeAgentTask(task) {
  return new Promise((resolve, reject) => {
    if (CONFIG.verbose) {
      console.log(`🔧 Starting agent for: ${task.filePath}`);
    }

    // Using the Task tool through a temporary script
    const tempScript = path.join(
      "/tmp",
      `fix-${Date.now()}-${Math.random().toString(36).substr(2, 9)}.sh`,
    );
    const scriptContent = `#!/bin/bash
# This script will be executed by Claude Code to fix linting errors

echo "Fixing linting errors in ${task.filePath}"
echo "${task.prompt}"
`;

    fs.writeFileSync(tempScript, scriptContent, { mode: 0o755 });

    // Note: In a real implementation, you would use the Claude Code API
    // or execute the agent through the appropriate interface
    // For now, this is a placeholder that simulates the agent execution

    // Simulate agent work (replace with actual Claude Code execution)
    setTimeout(
      () => {
        if (CONFIG.verbose) {
          console.log(`✅ Completed: ${task.filePath}`);
        }
        fs.unlinkSync(tempScript);
        resolve({ filePath: task.filePath, success: true });
      },
      2000 + Math.random() * 3000,
    );
  });
}

// Task queue manager with concurrency control
class TaskQueue {
  constructor(maxConcurrent) {
    this.maxConcurrent = maxConcurrent;
    this.running = 0;
    this.queue = [];
    this.results = [];
  }

  async add(task) {
    return new Promise((resolve) => {
      this.queue.push({ task, resolve });
      this.process();
    });
  }

  async process() {
    while (this.running < this.maxConcurrent && this.queue.length > 0) {
      const { task, resolve } = this.queue.shift();
      this.running++;

      executeAgentTask(task)
        .then((result) => {
          this.results.push(result);
          this.running--;
          resolve(result);
          this.process();
        })
        .catch((error) => {
          console.error(`❌ Error processing ${task.filePath}:`, error);
          this.running--;
          resolve({ filePath: task.filePath, success: false, error });
          this.process();
        });
    }
  }

  async waitForAll() {
    while (this.running > 0 || this.queue.length > 0) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    return this.results;
  }
}

// Main function
async function main() {
  console.log("🚀 Starting parallel lint fix process...");
  console.log(
    `📋 Configuration: Max ${CONFIG.maxConcurrentAgents} concurrent agents`,
  );

  try {
    // Parse the lint log
    const fileErrors = await parseLintLog(CONFIG.lintLogPath);
    console.log(`📊 Found ${fileErrors.size} files with linting errors`);

    // Create tasks for each file
    const tasks = [];
    for (const [filePath, errors] of fileErrors) {
      tasks.push(createAgentTask(filePath, errors));
    }

    // Execute tasks with concurrency control
    const taskQueue = new TaskQueue(CONFIG.maxConcurrentAgents);
    const promises = tasks.map((task) => taskQueue.add(task));

    // Wait for all tasks to complete
    console.log(`🔄 Processing ${tasks.length} files...`);
    await Promise.all(promises);
    const results = await taskQueue.waitForAll();

    // Summary
    const successful = results.filter((r) => r.success).length;
    const failed = results.filter((r) => !r.success).length;

    console.log("\\n📈 Summary:");
    console.log(`✅ Successfully processed: ${successful} files`);
    console.log(`❌ Failed: ${failed} files`);

    // Re-run lint to verify fixes
    console.log("\\n🔍 Running lint check to verify fixes...");
    const lintProcess = spawn("pnpm", ["lint"], { stdio: "inherit" });

    lintProcess.on("close", (code) => {
      if (code === 0) {
        console.log("✨ All linting errors fixed!");
      } else {
        console.log("⚠️  Some linting errors remain. Check the output above.");
      }
    });
  } catch (error) {
    console.error("❌ Error:", error);
    process.exit(1);
  }
}

// Handle CLI arguments
if (process.argv.includes("--help")) {
  console.log(`
Usage: node parallel-lint-fix.js [options]

Options:
  --max-agents <number>  Maximum number of concurrent agents (default: ${CONFIG.maxConcurrentAgents})
  --lint-log <path>      Path to lint log file (default: ${CONFIG.lintLogPath})
  --quiet                Disable verbose output
  --help                 Show this help message
`);
  process.exit(0);
}

// Parse CLI arguments
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  switch (args[i]) {
    case "--max-agents":
      CONFIG.maxConcurrentAgents =
        parseInt(args[++i]) || CONFIG.maxConcurrentAgents;
      break;
    case "--lint-log":
      CONFIG.lintLogPath = args[++i] || CONFIG.lintLogPath;
      break;
    case "--quiet":
      CONFIG.verbose = false;
      break;
  }
}

// Run the main function
main().catch(console.error);
