#!/usr/bin/env tsx
/**
 * Check event 557 configuration to diagnose SSH execution issues
 */

import { db } from "@/server/db";
import { events, servers, eventServers, jobs } from "@/shared/schema";
import { eq, desc, and } from "drizzle-orm";

async function checkEvent557() {
  console.log("=== Checking Event 557 Configuration ===\n");

  // 1. Get the event
  const [event] = await db
    .select({
      id: events.id,
      name: events.name,
      type: events.type,
      runLocation: events.runLocation,
      serverId: events.serverId,
      status: events.status,
    })
    .from(events)
    .where(eq(events.id, 557));

  if (!event) {
    console.error("❌ Event 557 not found!");
    process.exit(1);
  }

  console.log("📋 Event Details:");
  console.log(`  ID: ${event.id}`);
  console.log(`  Name: ${event.name}`);
  console.log(`  Type: ${event.type}`);
  console.log(`  Run Location: ${event.runLocation}`);
  console.log(`  Server ID: ${event.serverId}`);
  console.log(`  Status: ${event.status}`);
  console.log("");

  // Check critical fields for SSH execution
  console.log("🔍 SSH Execution Requirements:");
  if (event.runLocation === "REMOTE") {
    console.log("  ✅ Run Location is REMOTE");
  } else {
    console.log(
      `  ❌ Run Location is '${event.runLocation}' (should be 'REMOTE')`,
    );
  }

  if (event.serverId) {
    console.log(`  ✅ Server ID is set: ${event.serverId}`);

    // Check if server exists
    const [server] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, event.serverId));

    if (server) {
      console.log(`  ✅ Server exists: ${server.name} (${server.address})`);
    } else {
      console.log(`  ❌ Server with ID ${event.serverId} not found!`);
    }
  } else {
    console.log("  ❌ Server ID is not set");
  }
  console.log("");

  // 2. Check eventServers table (for multi-server support)
  const associatedServers = await db
    .select({
      serverId: eventServers.serverId,
      serverName: servers.name,
      serverAddress: servers.address,
    })
    .from(eventServers)
    .leftJoin(servers, eq(servers.id, eventServers.serverId))
    .where(eq(eventServers.eventId, 557));

  console.log("🖥️  Associated Servers (eventServers table):");
  if (associatedServers.length > 0) {
    associatedServers.forEach((s) => {
      console.log(
        `  - Server ${s.serverId}: ${s.serverName} (${s.serverAddress})`,
      );
    });
  } else {
    console.log("  No servers in eventServers table");
  }
  console.log("");

  // 3. Check recent jobs for this event
  const recentJobs = await db
    .select()
    .from(jobs)
    .where(eq(jobs.eventId, 557))
    .orderBy(desc(jobs.createdAt))
    .limit(3);

  console.log("📦 Recent Jobs:");
  if (recentJobs.length > 0) {
    for (const job of recentJobs) {
      console.log(`\n  Job ID: ${job.id}`);
      console.log(`  Type: ${job.type}`);
      console.log(`  Status: ${job.status}`);
      console.log(`  Created: ${job.createdAt}`);

      const payload = job.payload as any;
      console.log(`  Payload Target:`, payload?.target);

      // Check if job would be routed to SSH
      const wouldBeSSH = job.type === "SCRIPT" && payload?.target?.serverId;
      console.log(
        `  Would route to SSH executor: ${wouldBeSSH ? "✅ YES" : "❌ NO"}`,
      );

      if (!wouldBeSSH && job.type === "SCRIPT") {
        if (!payload?.target) {
          console.log("    Issue: No target in payload");
        } else if (!payload.target.serverId) {
          console.log("    Issue: No serverId in target");
        }
      }
    }
  } else {
    console.log("  No jobs found for this event");
  }
  console.log("");

  // 4. Diagnosis
  console.log("🔧 Diagnosis:");
  if (event.runLocation !== "REMOTE") {
    console.log(
      "  ⚠️  PROBLEM: Event runLocation must be 'REMOTE' for SSH execution",
    );
    console.log("  FIX: Update the event to set runLocation = 'REMOTE'");
  }
  if (!event.serverId && associatedServers.length === 0) {
    console.log("  ⚠️  PROBLEM: No server configured for this event");
    console.log(
      "  FIX: Either set serverId on the event OR add servers to eventServers table",
    );
  }

  if (
    event.runLocation === "REMOTE" &&
    (event.serverId || associatedServers.length > 0)
  ) {
    console.log("  ✅ Event is correctly configured for SSH execution");
    console.log("  If execution still fails, check:");
    console.log("    - SSH credentials are valid");
    console.log("    - Server is accessible");
    console.log("    - Runner binary is built");
    console.log("    - Payload generation is working");
  }
}

// Run the check
checkEvent557()
  .then(() => {
    console.log("\n✅ Check complete");
    process.exit(0);
  })
  .catch((error) => {
    console.error("\n❌ Error:", error);
    process.exit(1);
  });
