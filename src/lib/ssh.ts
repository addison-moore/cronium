import { EventType } from "@/shared/schema";
import { Client, ClientChannel } from "ssh2"; // Import Client from ssh2
interface SSHConnection {
  ssh: Client; // Changed from NodeSSH to ssh2 Client
  isConnected: boolean;
  host: string;
  lastUsed: number;
}

export class SSHService {
  private ssh?: Client; // Changed to optional ssh2 Client
  private isConnected: boolean = false;
  private connectionPool: Map<string, SSHConnection> = new Map();
  private maxConnections: number = 8; // Reduced to prevent overwhelming servers
  private connectionTimeout: number = 300000; // 5 minutes - longer for terminal sessions

  constructor() {
    // Clean up stale connections every 2 minutes
    setInterval(() => {
      this.cleanupStaleConnections();
    }, 120000);
  }

  private cleanupStaleConnections(): void {
    const now = Date.now();
    const keysToDelete: string[] = [];

    // Use Array.from to handle Map iteration
    Array.from(this.connectionPool.entries()).forEach(([key, connection]) => {
      if (now - connection.lastUsed > this.connectionTimeout) {
        try {
          connection.ssh.end();
        } catch (error) {
          // Ignore cleanup errors
        }
        keysToDelete.push(key);
      }
    });

    keysToDelete.forEach((key) => this.connectionPool.delete(key));
  }

  private getConnectionKey(
    host: string,
    username: string,
    port: number,
  ): string {
    return `${username}@${host}:${port}`;
  }

  private connectionLocks: Map<string, Promise<SSHConnection>> = new Map();
  private shellCache: Map<string, string> = new Map(); // Cache user shells per server

  private async getPooledConnection(
    host: string,
    privateKey: string,
    username: string = "root",
    port: number = 22,
    forceNew: boolean = false,
  ): Promise<SSHConnection> {
    const connectionKey = this.getConnectionKey(host, username, port);

    // Check if there's already a connection being established for this key
    if (this.connectionLocks.has(connectionKey)) {
      console.log(`Waiting for existing connection to ${connectionKey}...`);
      return await this.connectionLocks.get(connectionKey)!;
    }

    // Check if we have a valid existing connection and not forcing new
    if (!forceNew && this.connectionPool.has(connectionKey)) {
      const connection = this.connectionPool.get(connectionKey)!;
      if (connection.isConnected) {
        // Test the connection is still alive
        try {
          await new Promise<void>((resolve, reject) => {
            connection.ssh.exec('echo "test"', (err, stream) => {
              if (err) return reject(err);
              stream.on("close", () => resolve()).resume();
            });
          });
          connection.lastUsed = Date.now();
          console.log(`Reusing existing connection to ${connectionKey}`);
          return connection;
        } catch (error) {
          console.log(
            `Existing connection to ${connectionKey} failed test, removing...`,
          );
          // Connection is dead, remove it
          try {
            connection.ssh.end();
          } catch (endError) {
            // Ignore disposal errors
          }
          this.connectionPool.delete(connectionKey);
        }
      } else {
        // Remove stale connection
        this.connectionPool.delete(connectionKey);
      }
    }

    // Create a promise for the new connection and lock it
    const connectionPromise = this.createNewConnection(
      host,
      privateKey,
      username,
      port,
      connectionKey,
    );
    this.connectionLocks.set(connectionKey, connectionPromise);

    try {
      const connection = await connectionPromise;
      return connection;
    } finally {
      // Always remove the lock when done
      this.connectionLocks.delete(connectionKey);
    }
  }

  private async createNewConnection(
    host: string,
    privateKey: string,
    username: string,
    port: number,
    connectionKey: string,
  ): Promise<SSHConnection> {
    // Clean up old connections if we're at max capacity
    if (this.connectionPool.size >= this.maxConnections) {
      this.cleanupStaleConnections();
    }

    console.log(`Creating new SSH connection to ${connectionKey}...`);

    // Create new connection
    const ssh = new Client();

    return new Promise((resolve, reject) => {
      const connectionTimeout = setTimeout(() => {
        ssh.end();
        reject(new Error(`Connection to ${host} timed out.`));
      }, 20000); // Use readyTimeout from connect options

      ssh.on("ready", () => {
        clearTimeout(connectionTimeout);
        const connection: SSHConnection = {
          ssh,
          isConnected: true,
          host: connectionKey,
          lastUsed: Date.now(),
        };
        this.connectionPool.set(connectionKey, connection);
        console.log(`Successfully created SSH connection to ${connectionKey}`);
        resolve(connection);
      });
      ssh.on("error", (err) => {
        clearTimeout(connectionTimeout);
        console.error(
          `Failed to create SSH connection to ${connectionKey}:`,
          err,
        );
        reject(new Error(`Server ${host} is not reachable: ${err.message}`));
      });
      ssh.on("end", () => {
        console.log(`SSH connection to ${connectionKey} ended.`);
        this.connectionPool.delete(connectionKey);
      });
      ssh.on("close", () => {
        console.log(`SSH connection to ${connectionKey} closed.`);
        this.connectionPool.delete(connectionKey);
      });
      ssh.connect({
        host,
        username,
        privateKey: privateKey,
        port,
        readyTimeout: 20000,
        keepaliveInterval: 10000,
        keepaliveCountMax: 3,
        tryKeyboard: false,
        algorithms: {
          kex: [
            "ecdh-sha2-nistp256",
            "ecdh-sha2-nistp384",
            "ecdh-sha2-nistp521",
            "diffie-hellman-group14-sha256",
            "diffie-hellman-group16-sha512",
          ],
          cipher: [
            "aes128-ctr",
            "aes192-ctr",
            "aes256-ctr",
            "aes128-gcm",
            "aes256-gcm",
          ],
          serverHostKey: [
            "rsa-sha2-512",
            "rsa-sha2-256",
            "ssh-rsa",
            "ecdsa-sha2-nistp256",
          ],
          hmac: ["hmac-sha2-256", "hmac-sha2-512", "hmac-sha1"],
        },
      });
    });
  }

  /**
   * Establishes an SSH connection to a remote server
   */
  public async connect(
    host: string,
    privateKey: string,
    username: string = "root",
    port: number = 22,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const sshClient = new Client();
      const connectionTimeout = setTimeout(() => {
        sshClient.end();
        reject(new Error(`Connection to ${host} timed out.`));
      }, 60000); // Use readyTimeout from connect options

      sshClient
        .on("ready", () => {
          clearTimeout(connectionTimeout);
          this.ssh = sshClient;
          this.isConnected = true;
          resolve();
        })
        .on("error", (err) => {
          clearTimeout(connectionTimeout);
          this.isConnected = false;
          reject(err);
        })
        .connect({
          host,
          username,
          privateKey: privateKey,
          port,
          readyTimeout: 60000,
          keepaliveInterval: 5000,
          keepaliveCountMax: 10,
          tryKeyboard: false,
          algorithms: {
            kex: [
              "ecdh-sha2-nistp256",
              "ecdh-sha2-nistp384",
              "ecdh-sha2-nistp521",
              "diffie-hellman-group14-sha256",
            ],
            cipher: ["aes128-ctr", "aes192-ctr", "aes256-ctr"],
            serverHostKey: ["rsa-sha2-512", "rsa-sha2-256", "ssh-rsa"],
            hmac: ["hmac-sha2-256", "hmac-sha2-512"],
          },
        });
    });
  }

  /**
   * Tests an SSH connection to verify credentials and connectivity
   */
  public async testConnection(
    host: string,
    privateKey: string,
    username: string = "root",
    port: number = 22,
  ): Promise<{ success: boolean; message: string }> {
    try {
      await this.connect(host, privateKey, username, port);
      await this.disconnect();
      return { success: true, message: "Connection successful" };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown SSH connection error";
      return { success: false, message: errorMessage };
    }
  }

  /**
   * Disconnects the current SSH session
   */
  public async disconnect(): Promise<void> {
    if (this.isConnected && this.ssh) {
      this.ssh.end();
      this.isConnected = false;
      delete this.ssh;
    }
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
    timeoutMs: number = 900000,
    inputData: Record<string, any> = {},
    eventData: Record<string, any> = {},
    userVariables: Record<string, string> = {},
  ): Promise<{ stdout: string; stderr: string; scriptOutput?: any }> {
    let connection: SSHConnection | null = null;
    let workingDir = "";
    let usePooledConnection = false;

    try {
      // Use pooled connection for server-based execution
      if (server) {
        connection = await this.getPooledConnection(
          server.address,
          server.sshKey,
          server.username,
          server.port,
          false, // Don't force new connection unless needed
        );
        usePooledConnection = true;
      } else if (!this.isConnected) {
        throw new Error("SSH connection not established");
      }

      // Use either pooled connection or existing connection
      const activeSSH = connection ? connection.ssh : this.ssh;
      if (!activeSSH) {
        throw new Error("No active SSH connection available");
      }

      let command: string;
      let tempFile: string = "";
      const timestamp = Date.now();
      workingDir = `/tmp/cronium_${timestamp}`;

      // Create working directory
      await new Promise<void>((resolve, reject) => {
        activeSSH.exec(`mkdir -p ${workingDir}`, (err, stream) => {
          if (err) return reject(err);
          stream.on("close", () => resolve()).resume();
        });
      });

      // Write input data to input.json
      const inputJson = JSON.stringify(inputData, null, 2);
      await new Promise<void>((resolve, reject) => {
        activeSSH.exec(
          `echo '${inputJson.replace(/'/g, "'\\''")}' > ${workingDir}/input.json`,
          (err, stream) => {
            if (err) return reject(err);
            stream.on("close", () => resolve()).resume();
          },
        );
      });

      // Write event data to event.json
      const eventJson = JSON.stringify(eventData, null, 2);
      await new Promise<void>((resolve, reject) => {
        activeSSH.exec(
          `echo '${eventJson.replace(/'/g, "'\\''")}' > ${workingDir}/event.json`,
          (err, stream) => {
            if (err) return reject(err);
            stream.on("close", () => resolve()).resume();
          },
        );
      });

      // Write user variables to variables.json
      const variablesJson = JSON.stringify(userVariables, null, 2);
      await new Promise<void>((resolve, reject) => {
        activeSSH.exec(
          `echo '${variablesJson.replace(/'/g, "'\\''")}' > ${workingDir}/variables.json`,
          (err, stream) => {
            if (err) return reject(err);
            stream.on("close", () => resolve()).resume();
          },
        );
      });

      // Set environment variables
      const envString = Object.entries(envVars)
        .map(([key, value]) => `export ${key}="${value}"`)
        .join("; ");

      switch (scriptType) {
        case "BASH":
          tempFile = `${workingDir}/script_${timestamp}.sh`;
          // Create cronium.sh helper with full functionality
          const bashHelper = `#!/bin/bash

# Load input data automatically
_cronium_input_data=$(cat input.json 2>/dev/null || echo '{}')

# Load event data automatically
_cronium_event_data=$(cat event.json 2>/dev/null || echo '{}')

# Function to get input data
cronium_input() {
  echo "$_cronium_input_data"
}

# Function to set output data
cronium_output() {
  echo "$1" > output.json
}

# Function to get event metadata
cronium_event() {
  echo "$_cronium_event_data"
}

# Function to set condition
cronium_setCondition() {
  local condition="$1"
  echo "{\\"condition\\": $condition}" > condition.json
}

# Function to get condition
cronium_getCondition() {
  if [[ ! -f "condition.json" ]]; then
    echo "false"
    return
  fi
  
  if command -v jq >/dev/null 2>&1; then
    jq -r '.condition // false' condition.json 2>/dev/null
  else
    grep '"condition"' condition.json 2>/dev/null | sed 's/.*: *\\([^,}]*\\).*/\\1/' | head -1
  fi
}

# Function to get a variable value
cronium_getVariable() {
  local key="$1"
  
  if [[ ! -f "variables.json" ]]; then
    echo ""
    return
  fi
  
  if command -v jq >/dev/null 2>&1; then
    jq -r ".$key // empty" variables.json 2>/dev/null
  else
    grep "\\"$key\\"" variables.json 2>/dev/null | sed 's/.*: *"\\\\([^"]*\\\\)".*/\\\\1/' | head -1
  fi
}

# Function to set a variable value
cronium_setVariable() {
  local key="$1"
  local value="$2"
  local variables_data="{}"
  
  if [[ -f "variables.json" ]]; then
    variables_data=$(cat variables.json 2>/dev/null || echo '{}')
  fi
  
  if command -v jq >/dev/null 2>&1; then
    echo "$variables_data" | jq --arg key "$key" --arg value "$value" --arg updated "$(date -Iseconds)" '. + {($key): $value, "__updated__": $updated}' > variables.json
  else
    echo "{\\"$key\\": \\"$value\\", \\"__updated__\\": \\"$(date -Iseconds)\\"}" > variables.json
  fi
  
  echo "true"
}`;

          await new Promise<void>((resolve, reject) => {
            activeSSH.exec(
              `echo '${bashHelper.replace(/'/g, "'\\''")}' > ${workingDir}/cronium.sh`,
              (err, stream) => {
                if (err) return reject(err);
                stream.on("close", () => resolve()).resume();
              },
            );
          });
          await new Promise<void>((resolve, reject) => {
            activeSSH.exec(
              `chmod +x ${workingDir}/cronium.sh`,
              (err, stream) => {
                if (err) return reject(err);
                stream.on("close", () => resolve()).resume();
              },
            );
          });

          // Prepend source command to script with full path
          const modifiedBashScript = `#!/bin/bash\nsource ${workingDir}/cronium.sh\n\n${scriptContent}`;
          await new Promise<void>((resolve, reject) => {
            activeSSH.exec(
              `echo '${modifiedBashScript.replace(/'/g, "'\\''")}' > ${tempFile}`,
              (err, stream) => {
                if (err) return reject(err);
                stream.on("close", () => resolve()).resume();
              },
            );
          });
          await new Promise<void>((resolve, reject) => {
            activeSSH.exec(`chmod +x ${tempFile}`, (err, stream) => {
              if (err) return reject(err);
              stream.on("close", () => resolve()).resume();
            });
          });
          command = envString
            ? `cd ${workingDir} && ${envString}; ${tempFile}`
            : `cd ${workingDir} && ${tempFile}`;
          break;

        case "PYTHON":
          tempFile = `${workingDir}/script_${timestamp}.py`;
          // Create cronium.py helper with full functionality
          const pythonHelper = `import json
import os
import sys
from datetime import datetime

class Cronium:
    def __init__(self):
        # Load input data automatically
        try:
            with open("input.json", "r") as f:
                self._input_data = json.load(f)
        except FileNotFoundError:
            self._input_data = {}
        except json.JSONDecodeError:
            self._input_data = {}
        
        # Load event data automatically
        try:
            with open("event.json", "r") as f:
                self._event_data = json.load(f)
        except FileNotFoundError:
            self._event_data = {}
        except json.JSONDecodeError:
            self._event_data = {}

    def input(self):
        """Get input data"""
        return self._input_data

    def output(self, data):
        """Set output data to output.json file"""
        try:
            with open("output.json", "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Error writing output: {e}", file=sys.stderr)

    def event(self):
        """Get event metadata"""
        return self._event_data

    def setCondition(self, condition):
        """Set condition flag"""
        try:
            with open("condition.json", "w") as f:
                json.dump({"condition": bool(condition)}, f)
        except Exception as e:
            print(f"Error writing condition: {e}", file=sys.stderr)

    def getCondition(self):
        """Get condition flag"""
        try:
            with open("condition.json", "r") as f:
                data = json.load(f)
                return data.get("condition", False)
        except FileNotFoundError:
            return False
        except json.JSONDecodeError:
            return False

    def getVariable(self, key):
        """Get a variable value"""
        try:
            with open("variables.json", "r") as f:
                variables = json.load(f)
                return variables.get(key, "")
        except FileNotFoundError:
            return ""
        except json.JSONDecodeError:
            return ""

    def setVariable(self, key, value):
        """Set a variable value"""
        try:
            # Load existing variables
            variables = {}
            if os.path.exists("variables.json"):
                with open("variables.json", "r") as f:
                    variables = json.load(f)
            
            # Update the variable
            variables[key] = str(value)
            variables["__updated__"] = datetime.now().isoformat()
            
            # Save back to file
            with open("variables.json", "w") as f:
                json.dump(variables, f, indent=2)
            
            return True
        except Exception as e:
            print(f"Error setting variable: {e}", file=sys.stderr)
            return False

# Create global cronium instance
_cronium_instance = Cronium()

# Export functions at module level for clean API
input = _cronium_instance.input
output = _cronium_instance.output
event = _cronium_instance.event
setCondition = _cronium_instance.setCondition
getCondition = _cronium_instance.getCondition
getVariable = _cronium_instance.getVariable
setVariable = _cronium_instance.setVariable

# Also provide the class for compatibility
cronium = _cronium_instance`;

          await new Promise<void>((resolve, reject) => {
            activeSSH.exec(
              `echo '${pythonHelper.replace(/'/g, "'\\''")}' > ${workingDir}/cronium.py`,
              (err, stream) => {
                if (err) return reject(err);
                stream.on("close", () => resolve()).resume();
              },
            );
          });

          // Prepend import statement to script
          const modifiedPythonScript = `import cronium\n\n${scriptContent}`;
          await new Promise<void>((resolve, reject) => {
            activeSSH.exec(
              `echo '${modifiedPythonScript.replace(/'/g, "'\\''")}' > ${tempFile}`,
              (err, stream) => {
                if (err) return reject(err);
                stream.on("close", () => resolve()).resume();
              },
            );
          });
          command = envString
            ? `cd ${workingDir} && ${envString}; python3 ${tempFile}`
            : `cd ${workingDir} && python3 ${tempFile}`;
          break;

        case "NODEJS":
          tempFile = `${workingDir}/script_${timestamp}.js`;
          // Create cronium.js helper with full functionality
          const nodeHelper = `const fs = require("fs");

class Cronium {
  constructor() {
    // Load input data automatically
    try {
      this._inputData = JSON.parse(fs.readFileSync("input.json", "utf8"));
    } catch (error) {
      this._inputData = {};
    }
    
    // Load event data automatically
    try {
      this._eventData = JSON.parse(fs.readFileSync("event.json", "utf8"));
    } catch (error) {
      this._eventData = {};
    }
  }

  input() {
    return this._inputData;
  }

  output(data) {
    try {
      fs.writeFileSync("output.json", JSON.stringify(data, null, 2));
    } catch (error) {
      console.error("Error writing output:", error.message);
    }
  }

  event() {
    return this._eventData;
  }

  setCondition(condition) {
    try {
      fs.writeFileSync("condition.json", JSON.stringify({ condition: Boolean(condition) }, null, 2));
    } catch (error) {
      console.error("Error writing condition:", error.message);
    }
  }

  getCondition() {
    try {
      const conditionData = JSON.parse(fs.readFileSync("condition.json", "utf8"));
      return Boolean(conditionData.condition);
    } catch (error) {
      return false;
    }
  }

  getVariable(key) {
    try {
      const variables = JSON.parse(fs.readFileSync("variables.json", "utf8"));
      return variables[key] || "";
    } catch (error) {
      return ";
    }
  }

  setVariable(key, value) {
    try {
      let variables = {};
      
      // Load existing variables
      if (fs.existsSync("variables.json")) {
        variables = JSON.parse(fs.readFileSync("variables.json", "utf8"));
      }
      
      // Update the variable
      variables[key] = String(value);
      variables["__updated__"] = new Date().toISOString();
      
      // Save back to file
      fs.writeFileSync("variables.json", JSON.stringify(variables, null, 2));
      
      return true;
    } catch (error) {
      console.error("Error setting variable:", error.message);
      return false;
    }
  }
}

// Create and export cronium instance
const croniumInstance = new Cronium();

// Make cronium globally available
global.cronium = croniumInstance;

module.exports = croniumInstance;`;

          await new Promise<void>((resolve, reject) => {
            activeSSH.exec(
              `echo '${nodeHelper.replace(/'/g, "'\\''")}' > ${workingDir}/cronium.js`,
              (err, stream) => {
                if (err) return reject(err);
                stream.on("close", () => resolve()).resume();
              },
            );
          });

          // Prepend require statement to script
          const modifiedNodeScript = `const cronium = require('./cronium.js');\n\n${scriptContent}`;
          await new Promise<void>((resolve, reject) => {
            activeSSH.exec(
              `echo '${modifiedNodeScript.replace(/'/g, "'\\''")}' > ${tempFile}`,
              (err, stream) => {
                if (err) return reject(err);
                stream.on("close", () => resolve()).resume();
              },
            );
          });
          command = envString
            ? `cd ${workingDir} && ${envString}; node ${tempFile}`
            : `cd ${workingDir} && node ${tempFile}`;
          break;

        case "HTTP_REQUEST":
          // For HTTP requests, we'll use curl
          const httpConfig = JSON.parse(scriptContent);
          const curlOptions = [
            `-X ${httpConfig.method || "GET"}`,
            httpConfig.headers
              ? Object.entries(httpConfig.headers)
                  .map(([k, v]) => `-H "${k}: ${v}"`)
                  .join(" ")
              : "",
            httpConfig.body ? `-d '${JSON.stringify(httpConfig.body)}'` : "",
            httpConfig.url,
          ]
            .filter(Boolean)
            .join(" ");

          command = envString
            ? `cd ${workingDir} && ${envString}; curl ${curlOptions}`
            : `cd ${workingDir} && curl ${curlOptions}`;
          break;

        default:
          throw new Error(`Unsupported script type: ${scriptType}`);
      }

      const result = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          activeSSH.exec(
            command,
            {
              pty: true, // Request a PTY for interactive commands
              x11: false, // Disable X11 forwarding
              env: { ...process.env, TERM: "xterm" }, // Set TERM environment variable
              // Note: timeout is handled separately
            },
            (err, stream) => {
              if (err) return reject(err);
              let stdout = "";
              let stderr = "";
              stream.on("data", (data: Buffer) => (stdout += data.toString()));
              stream.stderr.on(
                "data",
                (data: Buffer) => (stderr += data.toString()),
              );
              stream.on("close", (code: number, signal: string) => {
                resolve({ stdout, stderr });
              });
            },
          );
        },
      );

      // Add a small delay to ensure all output is captured
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Try to read output.json if it exists
      let scriptOutput = null;
      try {
        const outputResult = await new Promise<{
          stdout: string;
          stderr: string;
        }>((resolve, reject) => {
          activeSSH.exec(`cat ${workingDir}/output.json`, (err, stream) => {
            if (err) return reject(err);
            let stdout = "";
            let stderr = "";
            stream.on("data", (data: Buffer) => (stdout += data.toString()));
            stream.stderr.on(
              "data",
              (data: Buffer) => (stderr += data.toString()),
            );
            stream.on("close", () => resolve({ stdout, stderr }));
          });
        });
        if (outputResult.stdout && !outputResult.stderr) {
          scriptOutput = JSON.parse(outputResult.stdout);
          console.log(`SSH: Found output.json with data:`, scriptOutput);
        } else {
          console.log(
            `SSH: No output.json found or has errors. stdout: "${outputResult.stdout}", stderr: "${outputResult.stderr}"`,
          );
        }
      } catch (error) {
        console.log(`SSH: Error reading output.json:`, error);
        // No output.json or parsing error, continue without it
      }

      // Try to read condition.json if it exists
      let condition: boolean | undefined = undefined;
      try {
        const conditionResult = await new Promise<{
          stdout: string;
          stderr: string;
        }>((resolve, reject) => {
          activeSSH.exec(`cat ${workingDir}/condition.json`, (err, stream) => {
            if (err) return reject(err);
            let stdout = "";
            let stderr = "";
            stream.on("data", (data: Buffer) => (stdout += data.toString()));
            stream.stderr.on(
              "data",
              (data: Buffer) => (stderr += data.toString()),
            );
            stream.on("close", () => resolve({ stdout, stderr }));
          });
        });
        if (conditionResult.stdout && !conditionResult.stderr) {
          const conditionData = JSON.parse(conditionResult.stdout);
          condition = Boolean(conditionData.condition);
          console.log(
            `Found condition file from SSH execution, condition: ${condition}`,
          );
        }
      } catch (error) {
        // No condition.json or parsing error, continue without it
      }

      // Try to read updated variables.json if it exists and persist to database
      if (eventData?.userId) {
        try {
          const variablesResult = await new Promise<{
            stdout: string;
            stderr: string;
          }>((resolve, reject) => {
            activeSSH.exec(
              `cat ${workingDir}/variables.json`,
              (err, stream) => {
                if (err) return reject(err);
                let stdout = "";
                let stderr = "";
                stream.on(
                  "data",
                  (data: Buffer) => (stdout += data.toString()),
                );
                stream.stderr.on(
                  "data",
                  (data: Buffer) => (stderr += data.toString()),
                );
                stream.on("close", () => resolve({ stdout, stderr }));
              },
            );
          });
          if (variablesResult.stdout && !variablesResult.stderr) {
            const updatedVariables = JSON.parse(variablesResult.stdout);

            // Remove metadata fields that aren't user variables
            delete updatedVariables.__updated__;

            // Compare with original variables to find changes
            const hasChanges =
              JSON.stringify(userVariables || {}) !==
              JSON.stringify(updatedVariables);

            if (hasChanges) {
              console.log(
                `Variables changed during SSH script execution, persisting to database for user ${eventData.userId}`,
              );

              // Import storage and persist updated variables
              const { storage } = await import("@/server/storage");

              // Get current variables from database to compare
              const currentDbVariables = await storage.getUserVariables(
                eventData.userId,
              );
              const currentDbVarMap = currentDbVariables.reduce(
                (acc: Record<string, string>, variable: any) => {
                  acc[variable.key] = variable.value;
                  return acc;
                },
                {} as Record<string, string>,
              );

              // Update or create variables that have changed
              for (const [key, value] of Object.entries(updatedVariables)) {
                if (currentDbVarMap[key] !== value) {
                  await storage.setUserVariable(
                    eventData.userId,
                    key,
                    String(value),
                  );
                  console.log(
                    `Updated variable ${key} for user ${eventData.userId}`,
                  );
                }
              }

              // Delete variables that were removed (exist in DB but not in updated file)
              for (const [key] of Object.entries(currentDbVarMap)) {
                if (!(key in updatedVariables)) {
                  await storage.deleteUserVariableByKey(eventData.userId, key);
                  console.log(
                    `Deleted variable ${key} for user ${eventData.userId}`,
                  );
                }
              }
            }
          }
        } catch (error) {
          console.error(
            "Failed to parse or persist updated variables.json from SSH execution:",
            error,
          );
        }
      }

      // Clean up working directory using the active SSH connection
      if (activeSSH && workingDir) {
        await new Promise<void>((resolve, reject) => {
          activeSSH.exec(`rm -rf ${workingDir}`, (err, stream) => {
            if (err) return reject(err);
            stream.on("close", () => resolve()).resume();
          });
        }).catch((cleanupError) => {
          console.error(
            `Failed to cleanup working directory ${workingDir}:`,
            cleanupError,
          );
        });
      }

      console.log(
        `SSH execution result for script: stdout length: ${result.stdout?.length || 0}, stderr length: ${result.stderr?.length || 0}, scriptOutput:`,
        scriptOutput,
      );

      return {
        stdout: result.stdout,
        stderr: result.stderr,
        scriptOutput: scriptOutput,
        condition: condition,
      } as {
        stdout: string;
        stderr: string;
        scriptOutput?: any;
        condition?: boolean;
        isTimeout?: boolean;
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error
          ? error.message
          : "Unknown script execution error";

      // Check if this is a timeout error
      const isTimeout =
        errorMessage.includes("timeout") || errorMessage.includes("TIMEOUT");

      return {
        stdout: "",
        stderr: errorMessage,
        isTimeout,
      } as {
        stdout: string;
        stderr: string;
        scriptOutput?: any;
        condition?: boolean;
        isTimeout?: boolean;
      };
    } finally {
      // Always attempt cleanup of working directory if it was created
      const activeSSH = connection ? connection.ssh : this.ssh;
      if (activeSSH && workingDir) {
        try {
          console.log(`Cleaning up working directory: ${workingDir}`);
          await new Promise<void>((resolve) => {
            activeSSH.exec(`rm -rf ${workingDir}`, (err, stream) => {
              if (err) {
                console.error(
                  `Failed to cleanup specific working directory ${workingDir}:`,
                  err,
                );
                return resolve();
              }
              stream.on("close", () => resolve()).resume();
            });
          });

          // Also clean up any stale working directories older than 5 minutes as a safety measure
          await new Promise<void>((resolve, reject) => {
            activeSSH.exec(
              `find /tmp -maxdepth 1 -name "cronium_*" -type d -mmin +5 -exec rm -rf {} + 2>/dev/null || true`,
              (err, stream) => {
                if (err) return reject(err);
                stream.on("close", () => resolve()).resume();
              },
            );
          }).catch(() => {
            // Ignore cleanup errors for stale directories
          });
        } catch (cleanupError) {
          console.log(
            `Final cleanup attempt completed with potential errors (ignored)`,
          );
        }
      }

      // For pooled connections, we don't disconnect - just update last used time
      // For direct connections, disconnect if we established it
      if (connection) {
        connection.lastUsed = Date.now();
      } else if (!usePooledConnection && this.isConnected) {
        await this.disconnect();
      }
    }
  }

  async checkServerHealth(server: {
    id: number;
    name: string;
    address: string;
    sshKey: string;
    username: string;
    port: number;
  }): Promise<{
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
  }> {
    try {
      await this.connect(
        server.address,
        server.sshKey,
        server.username,
        server.port,
      );

      // Get system information
      const platformResult = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        this.ssh!.exec("uname -s", (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          stream.on("data", (data: Buffer) => (stdout += data.toString()));
          stream.stderr.on(
            "data",
            (data: Buffer) => (stderr += data.toString()),
          );
          stream.on("close", () => resolve({ stdout, stderr }));
        });
      });
      const releaseResult = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        this.ssh!.exec("uname -r", (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          stream.on("data", (data: Buffer) => (stdout += data.toString()));
          stream.stderr.on(
            "data",
            (data: Buffer) => (stderr += data.toString()),
          );
          stream.on("close", () => resolve({ stdout, stderr }));
        });
      });
      const cpuResult = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          this.ssh!.exec("nproc", (err, stream) => {
            if (err) return reject(err);
            let stdout = "";
            let stderr = "";
            stream.on("data", (data: Buffer) => (stdout += data.toString()));
            stream.stderr.on(
              "data",
              (data: Buffer) => (stderr += data.toString()),
            );
            stream.on("close", () => resolve({ stdout, stderr }));
          });
        },
      );
      const memoryResult = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        this.ssh!.exec("free -h | grep Mem", (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          stream.on("data", (data: Buffer) => (stdout += data.toString()));
          stream.stderr.on(
            "data",
            (data: Buffer) => (stderr += data.toString()),
          );
          stream.on("close", () => resolve({ stdout, stderr }));
        });
      });
      const uptimeResult = await new Promise<{
        stdout: string;
        stderr: string;
      }>((resolve, reject) => {
        this.ssh!.exec("uptime -p", (err, stream) => {
          if (err) return reject(err);
          let stdout = "";
          let stderr = "";
          stream.on("data", (data: Buffer) => (stdout += data.toString()));
          stream.stderr.on(
            "data",
            (data: Buffer) => (stderr += data.toString()),
          );
          stream.on("close", () => resolve({ stdout, stderr }));
        });
      });

      await this.disconnect();

      // Parse memory information
      let totalMemory = "";
      let freeMemory = "";
      if (memoryResult.stdout) {
        const memParts = memoryResult.stdout.trim().split(/\s+/);
        if (memParts.length >= 4) {
          totalMemory = memParts[1] || "";
          freeMemory = memParts[3] || "";
        }
      }

      // Parse uptime
      let uptime = { days: 0, hours: 0, minutes: 0 };
      if (uptimeResult.stdout) {
        const uptimeStr = uptimeResult.stdout.replace("up ", "");
        const dayMatch = uptimeStr.match(/(\d+) days?/);
        const hourMatch = uptimeStr.match(/(\d+) hours?/);
        const minuteMatch = uptimeStr.match(/(\d+) minutes?/);

        if (dayMatch?.[1]) uptime.days = parseInt(dayMatch[1]);
        if (hourMatch?.[1]) uptime.hours = parseInt(hourMatch[1]);
        if (minuteMatch?.[1]) uptime.minutes = parseInt(minuteMatch[1]);
      }

      return {
        online: true,
        systemInfo: {
          platform: platformResult.stdout.trim() || "Unknown",
          release: releaseResult.stdout.trim() || "Unknown",
          cpuCores: parseInt(cpuResult.stdout.trim()) || 0,
          totalMemory,
          freeMemory,
          uptime,
        },
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Unknown health check error";
      return {
        online: false,
        systemInfo: {
          platform: "Unknown",
          release: "Unknown",
          cpuCores: 0,
          totalMemory: "0",
          freeMemory: "0",
          uptime: { days: 0, hours: 0, minutes: 0 },
        },
        error: errorMessage,
      };
    }
  }

  /**
   * Execute a simple command on a remote server using pooled connections
   * This is optimized for terminal-like operations with minimal latency
   */
  async executeCommand(
    host: string,
    privateKey: string,
    username: string = "root",
    port: number = 22,
    command: string,
    workingDirectory?: string,
  ): Promise<{ stdout: string; stderr: string }> {
    let connection: SSHConnection | null = null;

    try {
      // Get pooled connection for fast execution
      connection = await this.getPooledConnection(
        host,
        privateKey,
        username,
        port,
        false, // Don't force new connection
      );

      // Get the user's default shell for this connection
      const userShell = await this.getUserShell(
        host,
        privateKey,
        username,
        port,
      );

      // If a working directory is specified, prepend cd command
      let fullCommand = command;
      if (workingDirectory && workingDirectory !== "~") {
        fullCommand = `cd "${workingDirectory}" && ${command}`;
      }

      // Execute the command using the user's default shell
      const result = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          connection!.ssh.exec(
            `${userShell} -c '${fullCommand.replace(/'/g, "'\"'\"'")}'`,
            {
              pty: true, // Request a PTY for interactive commands
              x11: false, // Disable X11 forwarding
              env: { ...process.env, TERM: "xterm" }, // Set TERM environment variable
            },
            (err, stream) => {
              if (err) return reject(err);

              let stdout = "";
              let stderr = "";

              stream.on("data", (data: Buffer) => {
                stdout += data.toString();
              });

              stream.stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
              });

              stream.on("close", () => {
                resolve({ stdout, stderr });
              });
            },
          );
        },
      );

      // Update connection last used time
      connection.lastUsed = Date.now();

      return {
        stdout: result.stdout || "",
        stderr: result.stderr || "",
      };
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Command execution failed";
      return {
        stdout: "",
        stderr: errorMessage,
      };
    }
    // Note: We don't disconnect pooled connections - they're managed by the pool
  }

  /**
   * Get the user's default shell for a remote server (cached)
   */
  private async getUserShell(
    host: string,
    privateKey: string,
    username: string = "root",
    port: number = 22,
  ): Promise<string> {
    const connectionKey = this.getConnectionKey(host, username, port);

    // Return cached shell if available
    if (this.shellCache.has(connectionKey)) {
      return this.shellCache.get(connectionKey)!;
    }

    try {
      // Get user's default shell from $SHELL environment variable
      const connection = await this.getPooledConnection(
        host,
        privateKey,
        username,
        port,
        false,
      );
      const result = await new Promise<{ stdout: string; stderr: string }>(
        (resolve, reject) => {
          connection.ssh.exec('echo "$SHELL"', (err, stream) => {
            if (err) return reject(err);
            let stdout = "";
            let stderr = "";
            stream.on("data", (data: Buffer) => (stdout += data.toString()));
            stream.stderr.on(
              "data",
              (data: Buffer) => (stderr += data.toString()),
            );
            stream.on("close", () => resolve({ stdout, stderr }));
          });
        },
      );

      const userShell = result.stdout ? result.stdout.trim() : "/bin/bash";

      // Cache the shell for future use
      this.shellCache.set(connectionKey, userShell);

      return userShell;
    } catch (error) {
      // Fallback to bash if we can't detect the shell
      const fallbackShell = "/bin/bash";
      this.shellCache.set(connectionKey, fallbackShell);
      return fallbackShell;
    }
  }

  /**
   * Get the actual shell prompt from the remote server
   */
  async getShellPrompt(
    host: string,
    privateKey: string,
    username: string,
    port: number = 22,
    workingDirectory?: string,
  ): Promise<string> {
    try {
      // Get the user's default shell (cached)
      const userShell = await this.getUserShell(
        host,
        privateKey,
        username,
        port,
      );

      // Get the current shell prompt by echoing PS1 variable using the user's shell
      const result = await this.executeCommand(
        host,
        privateKey,
        username,
        port,
        `${userShell} -c 'echo $PS1'`,
        workingDirectory,
      );

      if (result.stdout && result.stdout.trim()) {
        // Process the PS1 variable to create a realistic prompt
        let prompt = result.stdout.trim();

        // Replace common PS1 variables with actual values
        const pwdResult = await this.executeCommand(
          host,
          privateKey,
          username,
          port,
          "pwd",
          workingDirectory,
        );
        const currentDir = pwdResult.stdout
          ? pwdResult.stdout.trim()
          : workingDirectory || "~";

        // Replace PS1 variables with actual values
        prompt = prompt
          .replace(/\\u/g, username)
          .replace(/\\h/g, host.split(".")[0] || host) // hostname without domain
          .replace(/\\H/g, host) // full hostname
          .replace(
            /\\w/g,
            currentDir.replace(new RegExp(`^/home/${username}`), "~"),
          )
          .replace(/\\W/g, currentDir.split("/").pop() || "~")
          .replace(/\\$/g, username === "root" ? "#" : "$")
          .replace(/\\\[|\\\]/g, "") // Remove color escape sequences markers
          .replace(/\\033\[[0-9;]*m/g, ""); // Remove basic color codes

        return prompt;
      }
    } catch (error) {
      console.log("Failed to get shell prompt, using fallback");
    }

    // Fallback to a reasonable prompt format
    const pwdResult = await this.executeCommand(
      host,
      privateKey,
      username,
      port,
      "pwd",
      workingDirectory,
    );
    const currentDir = pwdResult.stdout
      ? pwdResult.stdout.trim()
      : workingDirectory || "~";
    const shortDir = currentDir.replace(new RegExp(`^/home/${username}`), "~");
    return `${username}@${host.split(".")[0]}:${shortDir}${username === "root" ? "#" : "$"} `;
  }

  /**
   * Prewarm a connection for terminal use to reduce first-command latency
   */
  async prewarmConnection(
    host: string,
    privateKey: string,
    username: string = "root",
    port: number = 22,
  ): Promise<boolean> {
    try {
      console.log(
        `Prewarming SSH connection for terminal use: ${username}@${host}:${port}`,
      );

      // Create or get pooled connection
      const connection = await this.getPooledConnection(
        host,
        privateKey,
        username,
        port,
        false,
      );

      // Test connection with a simple command
      await new Promise<void>((resolve, reject) => {
        connection.ssh.exec('echo "connection test"', (err, stream) => {
          if (err) return reject(err);
          stream.on("close", () => resolve()).resume();
        });
      });

      connection.lastUsed = Date.now();
      console.log(
        `SSH connection prewarmed successfully: ${username}@${host}:${port}`,
      );
      return true;
    } catch (error) {
      console.error(
        `Failed to prewarm SSH connection: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
      return false;
    }
  }

  async openShell(
    host: string,
    privateKey: string,
    username: string = "root",
    port: number = 22,
    cols: number = 80,
    rows: number = 30,
  ): Promise<{ shell: ClientChannel; connectionKey: string }> {
    const connection = await this.getPooledConnection(
      host,
      privateKey,
      username,
      port,
      false, // Don't force new connection
    );

    const shell = await new Promise<ClientChannel>((resolve, reject) => {
      connection.ssh.shell(
        {
          term: "xterm",
          cols,
          rows,
        },
        (err, stream) => {
          if (err) return reject(err);
          resolve(stream);
        },
      );
    });

    console.log(`Opened interactive shell for ${connection.host}`);
    connection.lastUsed = Date.now(); // Update last used time

    return { shell, connectionKey: connection.host };
  }
}

export const sshService = new SSHService();
