#!/usr/bin/env node
/**
 * Health check script for Node.js Cronium container
 */

const { existsSync } = require("fs");
const { resolve } = require("path");

async function main() {
  try {
    // Check if cronium module can be loaded
    const croniumPath = resolve("/usr/local/lib/cronium.js");
    if (!existsSync(croniumPath)) {
      throw new Error("Cronium module not found");
    }

    // Try to require the module (without initializing since env vars might not be set)
    require(croniumPath);

    // Check Node.js version
    const nodeVersion = process.versions.node.split(".")[0];
    if (parseInt(nodeVersion) < 20) {
      throw new Error(`Node.js version too old: ${process.version}`);
    }

    // Check if axios is available
    try {
      require.resolve("axios");
    } catch (e) {
      throw new Error("axios module not found");
    }

    console.log("Health check passed");
    process.exit(0);
  } catch (error) {
    console.error(`Health check failed: ${error.message}`);
    process.exit(1);
  }
}

main();
