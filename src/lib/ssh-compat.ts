/**
 * SSH Compatibility Module
 *
 * This module provides a fallback interface for the SSH functionality when the native modules
 * are not available (like in browser environments or when binaries can't be loaded).
 *
 * It creates a mock implementation that allows the application to continue functioning
 * in development environments while gracefully handling the lack of actual SSH functionality.
 */

import { type EventType } from "@shared/schema";

// Define interfaces to match the real SSH service
interface ExecuteScriptResult {
  stdout: string;
  stderr: string;
}

interface CheckServerHealthResult {
  online: boolean;
  systemInfo: {
    platform?: string;
    release?: string;
    cpuCores?: number;
    totalMemory?: string;
    freeMemory?: string;
    uptime?: {
      days: number;
      hours: number;
      minutes: number;
    };
  };
  error?: string;
}

interface ServerInfo {
  id: number;
  name: string;
  address: string;
  sshKey: string;
  username: string;
  port: number;
}

// Define the interface for the native SSH service
interface NativeSSHService {
  connect(
    host: string,
    privateKey: string,
    username: string,
    port: number,
  ): Promise<void>;
  disconnect(): Promise<void>;
  testConnection(
    host: string,
    privateKey: string,
    username: string,
    port: number,
  ): Promise<{ success: boolean; message: string }>;
  executeScript(
    scriptType: EventType,
    scriptContent: string,
    envVars: Record<string, string>,
    server?: {
      address: string;
      sshKey: string;
      username: string;
      port: number;
    },
    timeoutMs?: number,
    inputData?: Record<string, unknown>,
    eventData?: Record<string, unknown>,
  ): Promise<ExecuteScriptResult>;
  checkServerHealth(server: ServerInfo): Promise<CheckServerHealthResult>;
}

// Mock SSH Service class that gracefully handles the absence of real SSH functionality
export class SSHCompatService {
  private isNativeAvailable = false;
  private nativeSSH: NativeSSHService | null = null;

  constructor() {
    this.tryLoadNative();
  }

  private tryLoadNative() {
    try {
      // Try to dynamically import the real SSH service
      // This will be skipped if the module can't be loaded
      if (typeof window === "undefined") {
        // Only try on server-side
        // We're not actually loading it here, just checking if it would be possible
        this.isNativeAvailable = false;
      }
    } catch {
      console.warn(
        "Native SSH module could not be loaded, using compatibility mode.",
      );
      this.isNativeAvailable = false;
    }
  }

  async connect(
    host: string,
    privateKey: string,
    username = "root",
    port = 22,
  ): Promise<void> {
    if (!this.isNativeAvailable) {
      console.log(
        "[SSH Compat] Connect called in compatibility mode (no action taken)",
      );
      return;
    }
    if (this.nativeSSH) {
      return this.nativeSSH.connect(host, privateKey, username, port);
    }
  }

  async disconnect(): Promise<void> {
    if (!this.isNativeAvailable) {
      console.log(
        "[SSH Compat] Disconnect called in compatibility mode (no action taken)",
      );
      return;
    }
    if (this.nativeSSH) {
      return this.nativeSSH.disconnect();
    }
  }

  async testConnection(
    host: string,
    privateKey: string,
    username = "root",
    port = 22,
  ): Promise<{ success: boolean; message: string }> {
    if (!this.isNativeAvailable) {
      console.log("[SSH Compat] Test connection called in compatibility mode");
      // Return a simulated response
      return {
        success: false,
        message:
          "SSH functionality is not available in this environment. This is a compatibility mode with limited functionality.",
      };
    }
    if (this.nativeSSH) {
      return this.nativeSSH.testConnection(host, privateKey, username, port);
    }
    // This should never be reached, but TypeScript needs a return
    return {
      success: false,
      message: "Native SSH module not available",
    };
  }

  async executeScript(
    scriptType: EventType,
    scriptContent: string,
    envVars: Record<string, string> = {},
    server?: {
      address: string;
      sshKey: string;
      username: string;
      port: number;
    },
    timeoutMs = 900000,
    inputData: Record<string, unknown> = {},
    eventData: Record<string, unknown> = {},
  ): Promise<ExecuteScriptResult> {
    if (!this.isNativeAvailable) {
      console.log("[SSH Compat] Execute script called in compatibility mode");
      // Return a simulated response
      return {
        stdout:
          "[SSH Compat Mode] Script execution simulated. Real SSH functionality is not available in this environment.",
        stderr: "",
      };
    }
    if (this.nativeSSH) {
      return this.nativeSSH.executeScript(
        scriptType,
        scriptContent,
        envVars,
        server,
        timeoutMs,
        inputData,
        eventData,
      );
    }
    // This should never be reached, but TypeScript needs a return
    return {
      stdout: "Native SSH module not available",
      stderr: "",
    };
  }

  async checkServerHealth(
    server: ServerInfo,
  ): Promise<CheckServerHealthResult> {
    if (!this.isNativeAvailable) {
      console.log(
        "[SSH Compat] Check server health called in compatibility mode",
      );
      // Return a simulated response with mock system info
      return {
        online: false,
        systemInfo: {
          platform: "Compatibility Mode",
          release: "N/A",
          cpuCores: 0,
          totalMemory: "0",
          freeMemory: "0",
          uptime: {
            days: 0,
            hours: 0,
            minutes: 0,
          },
        },
        error:
          "SSH functionality is not available in this environment. This is a compatibility mode with limited functionality.",
      };
    }
    if (this.nativeSSH) {
      return this.nativeSSH.checkServerHealth(server);
    }
    // This should never be reached, but TypeScript needs a return
    return {
      online: false,
      systemInfo: {
        platform: "N/A",
        release: "N/A",
        cpuCores: 0,
        totalMemory: "0",
        freeMemory: "0",
        uptime: {
          days: 0,
          hours: 0,
          minutes: 0,
        },
      },
      error: "Native SSH module not available",
    };
  }
}

export const sshCompatService = new SSHCompatService();
