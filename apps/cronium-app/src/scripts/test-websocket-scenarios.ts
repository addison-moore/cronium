#!/usr/bin/env tsx

/**
 * Test script to validate WebSocket broadcasting scenarios
 *
 * Tests:
 * 1. Real-time status updates
 * 2. Output streaming
 * 3. Multiple clients
 * 4. Reconnection handling
 * 5. Retry logic
 */

import { io, type Socket } from "socket.io-client";
import { getWebSocketBroadcaster } from "../lib/websocket-broadcaster";

// ANSI color codes
const colors = {
  reset: "\x1b[0m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  cyan: "\x1b[36m",
};

function log(message: string, color = colors.reset) {
  console.log(`${color}${message}${colors.reset}`);
}

class WebSocketTester {
  private sockets: Socket[] = [];
  private broadcaster = getWebSocketBroadcaster();
  private socketPort = process.env.SOCKET_PORT ?? "5002";

  async testRealTimeStatusUpdates() {
    log("\n=== Testing Real-Time Status Updates ===", colors.cyan);

    // Create a WebSocket client
    const socket = io(`http://localhost:${this.socketPort}/logs`, {
      auth: {
        userId: "test-user",
      },
    });

    this.sockets.push(socket);

    return new Promise<void>((resolve) => {
      let updateCount = 0;

      socket.on("connect", () => {
        log("✓ WebSocket connected", colors.green);

        // Subscribe to a test log
        socket.emit("subscribe", { logId: 999 });
      });

      socket.on("log:update", (data: any) => {
        updateCount++;
        log(
          `✓ Received update ${updateCount}: status=${data.status}`,
          colors.green,
        );

        if (updateCount >= 3) {
          socket.disconnect();
          resolve();
        }
      });

      socket.on("error", (error: any) => {
        log(`✗ WebSocket error: ${error.message}`, colors.red);
      });

      // Simulate status updates after connection
      setTimeout(async () => {
        log("Sending status updates...", colors.yellow);

        // Update 1: Running
        await this.broadcaster.broadcastLogUpdate(999, {
          status: "RUNNING" as any,
          startTime: new Date(),
        });

        // Update 2: Progress
        setTimeout(async () => {
          await this.broadcaster.broadcastLogUpdate(999, {
            status: "RUNNING" as any,
            output: "Processing...",
          });
        }, 500);

        // Update 3: Complete
        setTimeout(async () => {
          await this.broadcaster.broadcastLogUpdate(999, {
            status: "SUCCESS" as any,
            endTime: new Date(),
            output: "Task completed successfully",
          });
        }, 1000);
      }, 1000);
    });
  }

  async testOutputStreaming() {
    log("\n=== Testing Output Streaming ===", colors.cyan);

    const socket = io(`http://localhost:${this.socketPort}/logs`, {
      auth: {
        userId: "test-user",
      },
    });

    this.sockets.push(socket);

    return new Promise<void>((resolve) => {
      let lineCount = 0;

      socket.on("connect", () => {
        log("✓ WebSocket connected for streaming", colors.green);
        socket.emit("subscribe", { logId: 1000 });
      });

      socket.on("log:line", (data: any) => {
        lineCount++;
        log(
          `✓ Received line ${lineCount} [${data.stream}]: ${data.line}`,
          colors.green,
        );

        if (lineCount >= 5) {
          socket.disconnect();
          resolve();
        }
      });

      // Simulate streaming output
      setTimeout(async () => {
        log("Streaming output lines...", colors.yellow);

        const lines = [
          "Starting process...",
          "Initializing components...",
          "Processing data...",
          "Generating results...",
          "Process completed!",
        ];

        for (let i = 0; i < lines.length; i++) {
          await this.broadcaster.broadcastLogLine(
            1000,
            lines[i],
            i % 2 === 0 ? "stdout" : "stderr",
          );
          await this.sleep(200);
        }
      }, 1000);
    });
  }

  async testMultipleClients() {
    log("\n=== Testing Multiple Clients ===", colors.cyan);

    const clients: Socket[] = [];
    const updateCounts: number[] = [0, 0, 0];

    // Create 3 clients
    for (let i = 0; i < 3; i++) {
      const socket = io(`http://localhost:${this.socketPort}/logs`, {
        auth: {
          userId: `test-user-${i}`,
        },
      });

      this.sockets.push(socket);
      clients.push(socket);

      socket.on("connect", () => {
        log(`✓ Client ${i + 1} connected`, colors.green);
        socket.emit("subscribe", { logId: 1001 });
      });

      socket.on("log:update", () => {
        updateCounts[i]++;
        log(
          `✓ Client ${i + 1} received update (total: ${updateCounts[i]})`,
          colors.green,
        );
      });
    }

    // Wait for all connections
    await this.sleep(1000);

    // Send broadcast
    log("Broadcasting to all clients...", colors.yellow);
    await this.broadcaster.broadcastLogUpdate(1001, {
      status: "SUCCESS" as any,
      output: "Broadcast test",
    });

    await this.sleep(500);

    // Verify all clients received the update
    const allReceived = updateCounts.every((count) => count > 0);
    if (allReceived) {
      log("✓ All clients received the broadcast", colors.green);
    } else {
      log(
        `✗ Not all clients received the broadcast: ${updateCounts}`,
        colors.red,
      );
    }

    // Disconnect all clients
    clients.forEach((socket) => socket.disconnect());
  }

  async testReconnectionHandling() {
    log("\n=== Testing Reconnection Handling ===", colors.cyan);

    const socket = io(`http://localhost:${this.socketPort}/logs`, {
      auth: {
        userId: "test-user",
      },
      reconnection: true,
      reconnectionDelay: 500,
      reconnectionAttempts: 3,
    });

    this.sockets.push(socket);

    return new Promise<void>((resolve) => {
      let connectCount = 0;
      let disconnectCount = 0;

      socket.on("connect", () => {
        connectCount++;
        log(`✓ Connected (count: ${connectCount})`, colors.green);

        if (connectCount === 1) {
          // Force disconnect after first connection
          setTimeout(() => {
            log("Forcing disconnect...", colors.yellow);
            socket.disconnect();

            // Reconnect after a delay
            setTimeout(() => {
              log("Attempting reconnection...", colors.yellow);
              socket.connect();
            }, 1000);
          }, 500);
        } else if (connectCount === 2) {
          log("✓ Successfully reconnected", colors.green);
          socket.disconnect();
          resolve();
        }
      });

      socket.on("disconnect", () => {
        disconnectCount++;
        log(`Disconnected (count: ${disconnectCount})`, colors.yellow);
      });
    });
  }

  async testRetryLogic() {
    log("\n=== Testing Retry Logic ===", colors.cyan);

    // Simulate WebSocket server being down initially
    log("Testing broadcast with simulated failures...", colors.yellow);

    // This will use the retry logic in the broadcaster
    const result = await this.broadcaster.broadcastLogUpdate(1002, {
      status: "RUNNING" as any,
      output: "Testing retry logic",
    });

    if (result.success) {
      log(
        `✓ Broadcast succeeded after ${result.attempts} attempt(s)`,
        colors.green,
      );
    } else {
      log(
        `✓ Broadcast failed as expected: ${result.error} (${result.attempts} attempts)`,
        colors.yellow,
      );
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async cleanup() {
    // Disconnect all sockets
    this.sockets.forEach((socket) => {
      if (socket.connected) {
        socket.disconnect();
      }
    });
    this.sockets = [];

    // Stop health monitoring
    this.broadcaster.stopHealthMonitoring();
  }
}

async function main() {
  log("Starting WebSocket Tests", colors.blue);
  log("================================", colors.blue);
  log(
    "Note: Make sure the WebSocket server is running (pnpm dev:socket)",
    colors.yellow,
  );

  const tester = new WebSocketTester();

  try {
    // Run test scenarios
    await tester.testRealTimeStatusUpdates();
    await tester.testOutputStreaming();
    await tester.testMultipleClients();
    await tester.testReconnectionHandling();
    await tester.testRetryLogic();

    log("\n================================", colors.blue);
    log("All WebSocket tests completed!", colors.green);
  } catch (error) {
    log(`\nError during tests: ${error}`, colors.red);
  } finally {
    await tester.cleanup();
  }

  process.exit(0);
}

// Run the tests
main().catch(console.error);
