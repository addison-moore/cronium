/**
 * SSH service for script execution
 *
 * Handles SSH connections specifically for automated script execution
 * with proper runtime helper injection and output capture
 */

import { EventType } from "@/shared/schema";
import { SSHConnectionManager } from "./shared";
import type { NodeSSH } from "node-ssh";

export class ScriptExecutorSSHService {
  private connectionManager: SSHConnectionManager;

  constructor() {
    this.connectionManager = new SSHConnectionManager();
  }

  /**
   * Execute a script on a remote server via SSH with proper environment setup
   */
  async executeScript(
    scriptType: EventType,
    scriptContent: string,
    envVars: Record<string, string> = {},
    serverConfig: {
      address: string;
      sshKey: string;
      username: string;
      port: number;
    },
    _timeoutMs = 30000,
    input?: unknown,
    eventData?: { id: number; name: string; userId: string },
    userVariables?: Record<string, string>,
  ): Promise<{
    stdout: string;
    stderr: string;
    scriptOutput?: unknown;
    condition?: boolean;
  }> {
    let activeSSH: NodeSSH | null = null;
    let workingDir = "";

    try {
      // Get pooled connection
      const connection = await this.connectionManager.getPooledConnection(
        serverConfig.address,
        serverConfig.sshKey,
        serverConfig.username,
        serverConfig.port,
        false,
      );

      activeSSH = connection.ssh;

      // Create a temporary directory for script execution
      const tempDirResult = await activeSSH.execCommand("mktemp -d");
      if (tempDirResult.stderr || !tempDirResult.stdout) {
        throw new Error(
          `Failed to create temporary directory: ${tempDirResult.stderr ?? "No output"}`,
        );
      }
      workingDir = tempDirResult.stdout.trim();

      // Write input data if provided
      if (input) {
        await activeSSH.execCommand(
          `echo '${JSON.stringify(input).replace(/'/g, "'\\''")}' > ${workingDir}/input.json`,
        );
      }

      // Write variables data if provided
      if (userVariables) {
        await activeSSH.execCommand(
          `echo '${JSON.stringify(userVariables).replace(/'/g, "'\\''")}' > ${workingDir}/variables.json`,
        );
      } else {
        // Create empty variables file
        await activeSSH.execCommand(`echo '{}' > ${workingDir}/variables.json`);
      }

      // Build environment variables string
      const envString = Object.entries(envVars)
        .map(([key, value]) => `export ${key}="${value.replace(/"/g, '\\"')}"`)
        .join("; ");

      let command = "";
      let tempFile = "";

      switch (scriptType) {
        case EventType.NODEJS:
          tempFile = `${workingDir}/script.js`;

          // Create cronium runtime helper for Node.js
          const nodeHelper = `
const fs = require('fs');
const path = require('path');

class Cronium {
  constructor() {
    this._input_data = null;
    this._event_data = ${eventData ? JSON.stringify(eventData) : "null"};
    
    try {
      if (fs.existsSync('input.json')) {
        const inputContent = fs.readFileSync('input.json', 'utf8');
        this._input_data = JSON.parse(inputContent);
      }
    } catch (e) {
      console.error('Error loading input data:', e);
    }
  }

  input() {
    return this._input_data || {};
  }

  output(data) {
    try {
      fs.writeFileSync('output.json', JSON.stringify(data, null, 2));
      return true;
    } catch (e) {
      console.error('Error writing output:', e);
      return false;
    }
  }

  event() {
    return this._event_data;
  }

  setCondition(condition) {
    try {
      fs.writeFileSync('condition.json', JSON.stringify({ condition: Boolean(condition) }));
    } catch (e) {
      console.error('Error writing condition:', e);
    }
  }

  getCondition() {
    try {
      if (fs.existsSync('condition.json')) {
        const conditionContent = fs.readFileSync('condition.json', 'utf8');
        const data = JSON.parse(conditionContent);
        return data.condition || false;
      }
      return false;
    } catch (e) {
      return false;
    }
  }

  getVariable(key) {
    try {
      if (fs.existsSync('variables.json')) {
        const variablesContent = fs.readFileSync('variables.json', 'utf8');
        const variables = JSON.parse(variablesContent);
        return variables[key] ?? '';
      }
      return '';
    } catch (e) {
      return '';
    }
  }

  setVariable(key, value) {
    try {
      let variables = {};
      if (fs.existsSync('variables.json')) {
        const variablesContent = fs.readFileSync('variables.json', 'utf8');
        variables = JSON.parse(variablesContent);
      }
      
      variables[key] = String(value);
      variables['__updated__'] = new Date().toISOString();
      
      fs.writeFileSync('variables.json', JSON.stringify(variables, null, 2));
      return true;
    } catch (e) {
      console.error('Error writing variable:', e);
      return false;
    }
  }
}

global.cronium = new Cronium();
`;

          await activeSSH.execCommand(
            `echo '${nodeHelper.replace(/'/g, "'\\''")}' > ${workingDir}/cronium.js`,
          );

          // Prepend require statement to script
          const modifiedNodeScript = `require('./cronium.js');\n\n${scriptContent}`;
          await activeSSH.execCommand(
            `echo '${modifiedNodeScript.replace(/'/g, "'\\''")}' > ${tempFile}`,
          );
          command = envString
            ? `cd ${workingDir} && ${envString}; node ${tempFile}`
            : `cd ${workingDir} && node ${tempFile}`;
          break;

        case EventType.PYTHON:
          tempFile = `${workingDir}/script.py`;

          // Create cronium runtime helper for Python
          const pythonHelper = `
import json
import os
import sys
from datetime import datetime

class Cronium:
    def __init__(self):
        self._input_data = None
        self._event_data = ${eventData ? JSON.stringify(eventData) : "None"}
        
        try:
            if os.path.exists('input.json'):
                with open('input.json', 'r') as f:
                    self._input_data = json.load(f)
        except Exception as e:
            print(f"Error loading input data: {e}", file=sys.stderr)

    def input(self):
        return self._input_data or {}

    def output(self, data):
        try:
            with open('output.json', 'w') as f:
                json.dump(data, f, indent=2)
            return True
        except Exception as e:
            print(f"Error writing output: {e}", file=sys.stderr)
            return False

    def event(self):
        return self._event_data

    def setCondition(self, condition):
        try:
            with open("condition.json", "w") as f:
                json.dump({"condition": bool(condition)}, f)
        except Exception as e:
            print(f"Error writing condition: {e}", file=sys.stderr)

    def getCondition(self):
        try:
            with open("condition.json", "r") as f:
                data = json.load(f)
                return data.get("condition", False)
        except FileNotFoundError:
            return False
        except json.JSONDecodeError:
            return False

    def getVariable(self, key):
        try:
            with open("variables.json", "r") as f:
                variables = json.load(f)
                return variables.get(key, "")
        except FileNotFoundError:
            return ""
        except json.JSONDecodeError:
            return ""

    def setVariable(self, key, value):
        try:
            variables = {}
            if os.path.exists("variables.json"):
                with open("variables.json", "r") as f:
                    variables = json.load(f)
            
            variables[key] = str(value)
            variables["__updated__"] = datetime.now().isoformat()
            
            with open("variables.json", "w") as f:
                json.dump(variables, f, indent=2)
            return True
        except Exception as e:
            print(f"Error writing variable: {e}", file=sys.stderr)
            return False

cronium = Cronium()
`;

          await activeSSH.execCommand(
            `echo '${pythonHelper.replace(/'/g, "'\\''")}' > ${workingDir}/cronium.py`,
          );

          // Prepend import statement to script
          const modifiedPythonScript = `import sys\nsys.path.insert(0, '.')\nfrom cronium import cronium\n\n${scriptContent}`;
          await activeSSH.execCommand(
            `echo '${modifiedPythonScript.replace(/'/g, "'\\''")}' > ${tempFile}`,
          );
          command = envString
            ? `cd ${workingDir} && ${envString}; python3 ${tempFile}`
            : `cd ${workingDir} && python3 ${tempFile}`;
          break;

        case EventType.BASH:
          tempFile = `${workingDir}/script.sh`;

          // Create cronium runtime helper for Bash
          const bashHelper = `#!/bin/bash

# Function to get input data
cronium_input() {
  if [[ -f "input.json" ]]; then
    cat input.json 2>/dev/null || echo '{}'
  else
    echo '{}'
  fi
}

# Function to set output data
cronium_output() {
  local data="$1"
  echo "$data" > output.json
  echo "true"
}

# Function to get event metadata
cronium_event() {
  echo '${eventData ? JSON.stringify(eventData) : "{}"}'
}

# Function to set condition flag
cronium_setCondition() {
  local condition="$1"
  if [[ "$condition" == "true" || "$condition" == "1" ]]; then
    echo '{"condition": true}' > condition.json
  else
    echo '{"condition": false}' > condition.json
  fi
}

# Function to get condition flag
cronium_getCondition() {
  if [[ -f "condition.json" ]]; then
    if command -v jq >/dev/null 2>&1; then
      jq -r '.condition // false' condition.json 2>/dev/null || echo "false"
    else
      echo "false"
    fi
  else
    echo "false"
  fi
}

# Function to get a variable value
cronium_getVariable() {
  local key="$1"
  if [[ -f "variables.json" ]]; then
    if command -v jq >/dev/null 2>&1; then
      jq -r --arg key "$key" '.[$key] // ""' variables.json 2>/dev/null || echo ""
    else
      echo ""
    fi
  else
    echo ""
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

          await activeSSH.execCommand(
            `echo '${bashHelper.replace(/'/g, "'\\''")}' > ${workingDir}/cronium.sh`,
          );
          await activeSSH.execCommand(`chmod +x ${workingDir}/cronium.sh`);

          // Prepend source command to script with full path
          const modifiedBashScript = `#!/bin/bash\nsource ${workingDir}/cronium.sh\n\n${scriptContent}`;
          await activeSSH.execCommand(
            `echo '${modifiedBashScript.replace(/'/g, "'\\''")}' > ${tempFile}`,
          );
          await activeSSH.execCommand(`chmod +x ${tempFile}`);
          command = envString
            ? `cd ${workingDir} && ${envString}; ${tempFile}`
            : `cd ${workingDir} && ${tempFile}`;
          break;

        default:
          throw new Error(`Unsupported script type: ${scriptType}`);
      }

      const result = await activeSSH.execCommand(command, {
        execOptions: {
          // timeout is not a valid property for execOptions
          // timeouts should be handled at a different level
        },
      });

      // Add a small delay to ensure all output is captured
      await new Promise((resolve) => setTimeout(resolve, 500));

      // Try to read output.json if it exists
      let scriptOutput: unknown = null;
      try {
        const outputResult = await activeSSH.execCommand(
          `cat ${workingDir}/output.json`,
        );
        if (outputResult.stdout && !outputResult.stderr) {
          scriptOutput = JSON.parse(outputResult.stdout) as unknown;
          console.log(`SSH: Found output.json with data:`, scriptOutput);
        }
      } catch (error) {
        console.log(`SSH: Error reading output.json:`, error);
      }

      // Try to read condition.json if it exists
      let condition: boolean | undefined = undefined;
      try {
        const conditionResult = await activeSSH.execCommand(
          `cat ${workingDir}/condition.json`,
        );
        if (conditionResult.stdout && !conditionResult.stderr) {
          const conditionData = JSON.parse(conditionResult.stdout) as {
            condition?: boolean;
          };
          condition = Boolean(conditionData.condition);
          console.log(
            `Found condition file from SSH execution, condition: ${condition}`,
          );
        }
      } catch {
        // No condition.json or parsing error, continue without it
      }

      // Try to read updated variables.json if it exists and persist to database
      if (eventData?.userId) {
        try {
          const variablesResult = await activeSSH.execCommand(
            `cat ${workingDir}/variables.json`,
          );
          if (variablesResult.stdout && !variablesResult.stderr) {
            const updatedVariables = JSON.parse(
              variablesResult.stdout,
            ) as Record<string, unknown>;

            // Remove metadata fields that aren't user variables
            delete updatedVariables.__updated__;

            // Compare with original variables to find changes
            const hasChanges =
              JSON.stringify(userVariables ?? {}) !==
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
                (acc: Record<string, string>, variable) => {
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
          console.log(
            `Error reading or persisting variables from SSH execution:`,
            error,
          );
        }
      }

      const returnValue: {
        stdout: string;
        stderr: string;
        scriptOutput?: unknown;
        condition?: boolean;
      } = {
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
      };

      if (scriptOutput !== undefined) {
        returnValue.scriptOutput = scriptOutput;
      }

      if (condition !== undefined) {
        returnValue.condition = condition;
      }

      return returnValue;
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : "Script execution failed";
      console.error("SSH script execution error:", errorMessage);

      return {
        stdout: "",
        stderr: errorMessage,
      };
    } finally {
      // Cleanup: Remove temporary directory
      if (activeSSH && workingDir) {
        try {
          await activeSSH.execCommand(`rm -rf "${workingDir}"`);
          console.log(`Cleaned up temporary directory: ${workingDir}`);
        } catch (cleanupError) {
          console.error(
            `Failed to cleanup temporary directory ${workingDir}:`,
            cleanupError,
          );
        }
      }
    }
  }

  /**
   * Test SSH connection
   */
  async testConnection(
    host: string,
    privateKey: string,
    username = "root",
    port = 22,
  ): Promise<{ success: boolean; message: string }> {
    return this.connectionManager.testConnection(
      host,
      privateKey,
      username,
      port,
    );
  }

  /**
   * Dispose of all connections and cleanup
   */
  dispose() {
    this.connectionManager.dispose();
  }
}

export const scriptExecutorSSHService = new ScriptExecutorSSHService();
