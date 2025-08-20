import { db } from "@/server/db";
import { events, runnerPayloads } from "@/shared/schema";
import type { Event, RunnerPayload } from "@/shared/schema";
import { eq, and } from "drizzle-orm";
import * as fs from "fs/promises";
import * as path from "path";
import * as crypto from "crypto";
import * as yaml from "js-yaml";
import * as tar from "tar";

interface PayloadManifest {
  version: string;
  interpreter: string;
  entrypoint: string;
  environment?: Record<string, string>;
  metadata: {
    jobId?: string;
    eventId: string;
    eventVersion: number;
    createdAt: string;
    executionId?: string;
    eventName?: string;
    trigger?: string;
    apiEndpoint?: string;
    apiToken?: string;
    inputData?: unknown;
    extra?: Record<string, unknown>;
  };
}

export class PayloadService {
  private readonly payloadDir: string;

  constructor() {
    // Use a directory relative to the project root
    this.payloadDir =
      process.env.RUNNER_PAYLOADS_DIR ??
      path.join(process.cwd(), "storage", "payloads");
  }

  async ensurePayloadDirectory(): Promise<void> {
    await fs.mkdir(this.payloadDir, { recursive: true });
  }

  /**
   * Generate a payload for an event
   */
  async generatePayload(
    event: Event,
    envVars?: Array<{ key: string; value: string }>,
  ): Promise<RunnerPayload> {
    await this.ensurePayloadDirectory();

    // Increment payload version
    const newVersion = (event.payloadVersion || 0) + 1;

    // Create temporary directory for payload contents
    const tempDir = path.join(
      this.payloadDir,
      "temp",
      `event-${event.id}-v${newVersion}`,
    );
    await fs.mkdir(tempDir, { recursive: true });

    try {
      // Write script file
      const scriptFilename = this.getScriptFilename(event.type);
      const scriptPath = path.join(tempDir, scriptFilename);
      await fs.writeFile(scriptPath, event.content ?? "", { mode: 0o755 });

      // Create manifest
      const manifest: PayloadManifest = {
        version: "v1",
        interpreter: this.getInterpreter(event.type),
        entrypoint: scriptFilename,
        environment: this.buildEnvironment(envVars),
        metadata: {
          eventId: String(event.id),
          eventVersion: newVersion,
          createdAt: new Date().toISOString(),
          eventName: event.name,
          // Additional metadata will be populated by the orchestrator
          // when creating the job (executionId, jobId, apiEndpoint, etc.)
        },
      };

      // Write manifest
      const manifestPath = path.join(tempDir, "manifest.yaml");
      await fs.writeFile(manifestPath, yaml.dump(manifest));

      // Create tar.gz archive
      const payloadFilename = `event-${event.id}-v${newVersion}.tar.gz`;
      const payloadPath = path.join(this.payloadDir, payloadFilename);

      await this.createTarGz(tempDir, payloadPath);

      // Calculate checksum
      const checksum = await this.calculateChecksum(payloadPath);
      const checksumPath = `${payloadPath}.sha256`;
      await fs.writeFile(checksumPath, `${checksum}  ${payloadFilename}\n`);

      // Get file size
      const stats = await fs.stat(payloadPath);

      // Mark previous payloads as inactive
      await db
        .update(runnerPayloads)
        .set({ isActive: false })
        .where(eq(runnerPayloads.eventId, event.id));

      // Create database record
      const [payload] = await db
        .insert(runnerPayloads)
        .values({
          eventId: event.id,
          eventVersion: newVersion,
          payloadPath,
          checksumPath,
          payloadSize: stats.size,
          checksum,
          isActive: true,
        })
        .returning();

      if (!payload) {
        throw new Error("Failed to create payload record");
      }

      // Update event payload version
      await db
        .update(events)
        .set({ payloadVersion: newVersion })
        .where(eq(events.id, event.id));

      return payload;
    } finally {
      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  }

  /**
   * Remove old payloads when an event is updated
   */
  async removeOldPayloads(eventId: number, keepLatest = 1): Promise<void> {
    // Get all payloads for this event, ordered by version desc
    const payloads = await db
      .select()
      .from(runnerPayloads)
      .where(eq(runnerPayloads.eventId, eventId))
      .orderBy(runnerPayloads.eventVersion);

    // Keep only the latest N payloads
    const toDelete = payloads.slice(0, -keepLatest);

    for (const payload of toDelete) {
      try {
        // Delete files
        await fs.unlink(payload.payloadPath).catch(() => {
          // Ignore errors
        });
        if (payload.checksumPath) {
          await fs.unlink(payload.checksumPath).catch(() => {
            // Ignore errors
          });
        }

        // Delete database record
        await db
          .delete(runnerPayloads)
          .where(eq(runnerPayloads.id, payload.id));
      } catch (error) {
        console.error(`Failed to delete payload ${payload.id}:`, error);
      }
    }
  }

  /**
   * Get the active payload for an event
   */
  async getActivePayload(eventId: number): Promise<RunnerPayload | null> {
    const [payload] = await db
      .select()
      .from(runnerPayloads)
      .where(
        and(
          eq(runnerPayloads.eventId, eventId),
          eq(runnerPayloads.isActive, true),
        ),
      )
      .limit(1);

    return payload ?? null;
  }

  /**
   * Create a job-specific payload with updated manifest
   */
  async createJobSpecificPayload(
    originalPayloadPath: string,
    jobId: string,
    executionId?: string,
  ): Promise<string> {
    const tempDir = path.join(this.payloadDir, "temp", `update-${jobId}`);

    try {
      // Ensure the original payload exists
      await fs.access(originalPayloadPath);

      // Create temp directory for extraction
      await fs.mkdir(tempDir, { recursive: true });

      // Extract the payload
      await tar.x({
        file: originalPayloadPath,
        cwd: tempDir,
      });

      // Read the manifest
      const manifestPath = path.join(tempDir, "manifest.yaml");
      const manifestContent = await fs.readFile(manifestPath, "utf-8");
      const manifest = yaml.load(manifestContent) as PayloadManifest;

      // Update metadata with jobId
      manifest.metadata = {
        ...manifest.metadata,
        jobId,
        ...(executionId && { executionId }),
      };

      // Write updated manifest
      await fs.writeFile(manifestPath, yaml.dump(manifest));

      // Create new tar.gz with updated manifest - job-specific filename
      const jobPayloadPath = path.join(this.payloadDir, `job-${jobId}.tar.gz`);

      await tar.c(
        {
          gzip: true,
          file: jobPayloadPath,
          cwd: tempDir,
        },
        ["."],
      );

      // Clean up temp directory
      await fs.rm(tempDir, { recursive: true, force: true });

      return jobPayloadPath;
    } catch (error) {
      // Clean up temp directory on error
      try {
        await fs.rm(tempDir, { recursive: true, force: true });
      } catch (cleanupErr) {
        console.error("Failed to clean up temp directory:", cleanupErr);
      }

      console.error("Failed to create job-specific payload:", error);
      throw error;
    }
  }

  /**
   * Clean up all payloads for a deleted event
   */
  async cleanupEventPayloads(eventId: number): Promise<void> {
    const payloads = await db
      .select()
      .from(runnerPayloads)
      .where(eq(runnerPayloads.eventId, eventId));

    for (const payload of payloads) {
      try {
        await fs.unlink(payload.payloadPath).catch(() => {
          // Ignore errors
        });
        if (payload.checksumPath) {
          await fs.unlink(payload.checksumPath).catch(() => {
            // Ignore errors
          });
        }
      } catch (error) {
        console.error(
          `Failed to delete payload file ${payload.payloadPath}:`,
          error,
        );
      }
    }

    // Records will be deleted by cascade
  }

  private getScriptFilename(eventType: string): string {
    switch (eventType) {
      case "NODEJS":
        return "script.js";
      case "PYTHON":
        return "script.py";
      case "BASH":
        return "script.sh";
      default:
        return "script";
    }
  }

  private getInterpreter(eventType: string): string {
    switch (eventType) {
      case "NODEJS":
        return "node";
      case "PYTHON":
        return "python";
      case "BASH":
        return "bash";
      default:
        return "bash";
    }
  }

  private buildEnvironment(
    envVars?: Array<{ key: string; value: string }>,
  ): Record<string, string> {
    const env: Record<string, string> = {};
    if (envVars) {
      for (const { key, value } of envVars) {
        env[key] = value;
      }
    }
    return env;
  }

  private async createTarGz(
    sourceDir: string,
    outputPath: string,
  ): Promise<void> {
    await tar.create(
      {
        gzip: true,
        file: outputPath,
        cwd: sourceDir,
      },
      ["."],
    );
  }

  private async calculateChecksum(filePath: string): Promise<string> {
    const fileBuffer = await fs.readFile(filePath);
    const hash = crypto.createHash("sha256");
    hash.update(fileBuffer);
    return hash.digest("hex");
  }
}

// Export singleton instance
export const payloadService = new PayloadService();
