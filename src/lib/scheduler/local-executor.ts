import { EventType, type UserVariable } from "@shared/schema";
import { promisify } from "util";
import { exec } from "child_process";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";

const execPromise = promisify(exec);

// Type definitions for script execution
interface ScriptExecutionResult {
  stdout: string;
  stderr: string;
  output?: unknown;
  condition?: boolean;
  isTimeout?: boolean;
}

interface ScriptExecutionData {
  eventId?: number;
  userId?: string;
  name?: string;
  description?: string;
  [key: string]: unknown;
}

interface ExecError extends Error {
  killed?: boolean;
  signal?: string;
  code?: number;
}

// Type guard for condition data
function isConditionData(data: unknown): data is { condition: unknown } {
  return typeof data === "object" && data !== null && "condition" in data;
}

// Type guard for updatedVariables
function isValidVariablesObject(data: unknown): data is Record<string, string> {
  if (typeof data !== "object" || data === null) {
    return false;
  }
  return Object.entries(data).every(
    ([key, value]) => typeof key === "string" && typeof value === "string",
  );
}

/**
 * Execute a script locally based on its type with input/output support
 * @param eventType The type of event/script to execute
 * @param scriptContent The content of the script to run
 * @param envVars Environment variables to pass to the script
 * @param timeoutMs Timeout in milliseconds
 * @param input Input data to pass to the script
 */
export async function executeLocalScript(
  eventType: EventType,
  scriptContent: string,
  envVars: Record<string, string> = {},
  timeoutMs = 30000,
  input: Record<string, unknown> = {},
  eventData: ScriptExecutionData = {},
): Promise<ScriptExecutionResult> {
  try {
    // Create a temporary directory for this script execution
    const tmpDir = os.tmpdir();
    const timestamp = new Date().getTime();
    const scriptDir = path.join(tmpDir, `cronium_script_${timestamp}`);
    fs.mkdirSync(scriptDir, { recursive: true });

    let filePath = "";
    let command = "";
    let modifiedScriptContent = scriptContent;

    // Write input.json to the script directory
    const inputFilePath = path.join(scriptDir, "input.json");
    fs.writeFileSync(inputFilePath, JSON.stringify(input, null, 2));

    // Write event.json to the script directory
    const eventFilePath = path.join(scriptDir, "event.json");
    fs.writeFileSync(eventFilePath, JSON.stringify(eventData, null, 2));

    // Fetch and write user variables to variables.json
    let userVariables: Record<string, string> = {};
    if (eventData.userId) {
      try {
        const { storage } = await import("@server/storage");
        const variables = await storage.getUserVariables(eventData.userId);
        userVariables = variables.reduce(
          (acc: Record<string, string>, variable: UserVariable) => {
            acc[variable.key] = variable.value;
            return acc;
          },
          {} as Record<string, string>,
        );
      } catch (error) {
        console.error(
          `Failed to fetch user variables for user ${eventData.userId}:`,
          error,
        );
      }
    }

    const variablesFilePath = path.join(scriptDir, "variables.json");
    fs.writeFileSync(variablesFilePath, JSON.stringify(userVariables, null, 2));

    // Copy runtime helpers to the script directory
    const runtimeHelpersDir = path.join(
      process.cwd(),
      "src",
      "runtime-helpers",
    );

    // Set up the script file based on its type
    switch (eventType) {
      case EventType.BASH:
        filePath = path.join(scriptDir, `script_${timestamp}.sh`);

        // Copy cronium.sh helper
        const bashHelperSrc = path.join(runtimeHelpersDir, "cronium.sh");
        const bashHelperDst = path.join(scriptDir, "cronium.sh");
        if (fs.existsSync(bashHelperSrc)) {
          fs.copyFileSync(bashHelperSrc, bashHelperDst);
          fs.chmodSync(bashHelperDst, 0o755);
        }

        // Prepend source command to script
        modifiedScriptContent = `#!/bin/bash\nsource ./cronium.sh\n\n${scriptContent}`;
        fs.writeFileSync(filePath, modifiedScriptContent, { mode: 0o755 });
        command = `bash "${filePath}"`;
        break;

      case EventType.NODEJS:
        filePath = path.join(scriptDir, `script_${timestamp}.js`);

        // Copy cronium.js helper
        const jsHelperSrc = path.join(runtimeHelpersDir, "cronium.js");
        const jsHelperDst = path.join(scriptDir, "cronium.js");
        console.log(
          `Attempting to copy Node.js helper from ${jsHelperSrc} to ${jsHelperDst}`,
        );
        if (fs.existsSync(jsHelperSrc)) {
          fs.copyFileSync(jsHelperSrc, jsHelperDst);
          console.log(
            `Successfully copied Node.js cronium helper to ${jsHelperDst}`,
          );
        } else {
          console.error(`Node.js cronium helper not found at ${jsHelperSrc}`);
        }

        // Prepend require statement to script
        modifiedScriptContent = `const cronium = require('./cronium.js');\n\n${scriptContent}`;
        fs.writeFileSync(filePath, modifiedScriptContent);
        command = `node "${filePath}"`;
        break;

      case EventType.PYTHON:
        filePath = path.join(scriptDir, `script_${timestamp}.py`);

        // Copy cronium.py helper
        const pyHelperSrc = path.join(runtimeHelpersDir, "cronium.py");
        const pyHelperDst = path.join(scriptDir, "cronium.py");
        console.log(
          `Attempting to copy Python helper from ${pyHelperSrc} to ${pyHelperDst}`,
        );
        if (fs.existsSync(pyHelperSrc)) {
          fs.copyFileSync(pyHelperSrc, pyHelperDst);
          console.log(
            `Successfully copied Python cronium helper to ${pyHelperDst}`,
          );
        } else {
          console.error(`Python cronium helper not found at ${pyHelperSrc}`);
        }

        // Prepend import statement to script
        modifiedScriptContent = `import cronium\n\n${scriptContent}`;
        fs.writeFileSync(filePath, modifiedScriptContent);
        command = `python "${filePath}"`;
        break;

      default:
        // Clean up directory before returning
        fs.rmSync(scriptDir, { recursive: true, force: true });
        return {
          stdout: "",
          stderr: `Unsupported script type: ${eventType} for local execution`,
          isTimeout: false,
        };
    }

    // Prepare environment variables
    const env = { ...process.env };

    // Add custom environment variables
    for (const [key, value] of Object.entries(envVars)) {
      env[key] = value;
    }

    // Add a diagnostic log file to confirm execution
    const diagFile = path.join(tmpDir, `executed_${timestamp}.log`);
    fs.writeFileSync(
      diagFile,
      `Script was executed at ${new Date().toISOString()}\n`,
    );

    // Change to the script directory for execution
    const originalCwd = process.cwd();
    process.chdir(scriptDir);

    try {
      // Execute the script with the specified timeout
      const result = await execPromise(command, {
        env,
        timeout: timeoutMs,
        maxBuffer: 1024 * 1024, // 1MB buffer
        cwd: scriptDir,
      });

      // Check for output.json file after execution
      const outputFilePath = path.join(scriptDir, "output.json");
      let output: unknown = undefined;

      if (fs.existsSync(outputFilePath)) {
        try {
          const outputContent = fs.readFileSync(outputFilePath, "utf8");
          output = JSON.parse(outputContent);
        } catch (parseError) {
          console.error("Failed to parse output.json:", parseError);
          // Include the raw output content in stderr if parsing fails
          result.stderr =
            (result.stderr || "") +
            `\nWarning: Failed to parse output.json: ${parseError}`;
        }
      }

      // Check for condition.json file after execution
      const conditionFilePath = path.join(scriptDir, "condition.json");
      let condition: boolean | undefined = undefined;

      if (fs.existsSync(conditionFilePath)) {
        try {
          const conditionContent = fs.readFileSync(conditionFilePath, "utf8");
          const conditionData: unknown = JSON.parse(conditionContent);
          if (isConditionData(conditionData)) {
            condition = Boolean(conditionData.condition);
          } else {
            console.error(
              "Invalid condition.json format: missing 'condition' field",
            );
          }
          console.log(
            `Found condition file for script execution, condition: ${condition}`,
          );
        } catch (parseError) {
          console.error("Failed to parse condition.json:", parseError);
          // Include the condition parse error in stderr if parsing fails
          result.stderr =
            (result.stderr || "") +
            `\nWarning: Failed to parse condition.json: ${parseError}`;
        }
      }

      // Check for updated variables.json file after execution and persist to database
      const updatedVariablesPath = path.join(scriptDir, "variables.json");
      if (fs.existsSync(updatedVariablesPath) && eventData.userId) {
        try {
          const updatedVariablesContent = fs.readFileSync(
            updatedVariablesPath,
            "utf8",
          );
          const parsedVariables: unknown = JSON.parse(updatedVariablesContent);

          let updatedVariables: Record<string, string> | null = null;

          if (!isValidVariablesObject(parsedVariables)) {
            console.error(
              "Invalid variables.json format: expected object with string values",
            );
            result.stderr =
              (result.stderr || "") +
              `\nWarning: Invalid variables.json format: expected object with string values`;
          } else {
            updatedVariables = { ...parsedVariables };
            // Remove metadata fields that aren't user variables
            if ("__updated__" in updatedVariables) {
              delete updatedVariables.__updated__;
            }

            // Compare with original variables to find changes
            const hasChanges =
              JSON.stringify(userVariables) !==
              JSON.stringify(updatedVariables);

            if (hasChanges && updatedVariables) {
              console.log(
                `Variables changed during script execution, persisting to database for user ${eventData.userId}`,
              );

              // Import storage and persist updated variables
              const { storage } = await import("@server/storage");

              // Get current variables from database to compare
              const currentDbVariables = await storage.getUserVariables(
                eventData.userId,
              );
              const currentDbVarMap = currentDbVariables.reduce(
                (acc: Record<string, string>, variable: UserVariable) => {
                  acc[variable.key] = variable.value;
                  return acc;
                },
                {} as Record<string, string>,
              );

              // Update or create variables that have changed
              for (const [key, value] of Object.entries(updatedVariables)) {
                if (
                  typeof value === "string" &&
                  currentDbVarMap[key] !== value
                ) {
                  await storage.setUserVariable(eventData.userId, key, value);
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
          } // Close the else block
        } catch (parseError) {
          console.error(
            "Failed to parse or persist updated variables.json:",
            parseError,
          );
          result.stderr =
            (result.stderr || "") +
            `\nWarning: Failed to persist variable changes: ${parseError}`;
        }
      }

      const returnValue: ScriptExecutionResult = {
        stdout: result.stdout,
        stderr: result.stderr,
      };

      if (output !== undefined) {
        returnValue.output = output;
      }

      if (condition !== undefined) {
        returnValue.condition = condition;
      }

      return returnValue;
    } finally {
      // Restore original working directory
      process.chdir(originalCwd);

      // Clean up the temporary directory
      try {
        fs.rmSync(scriptDir, { recursive: true, force: true });
      } catch (cleanupError) {
        console.error(
          `Failed to remove temporary script directory ${scriptDir}:`,
          cleanupError,
        );
      }
    }
  } catch (err) {
    const error = err as ExecError;
    console.error("Error executing local script:", error);

    // Check if this is a timeout error
    const isTimeout = error.killed === true && error.signal === "SIGTERM";

    const errorReturn: ScriptExecutionResult = {
      stdout: "",
      stderr: error.message || "Unknown error executing local script",
    };

    if (isTimeout) {
      errorReturn.isTimeout = isTimeout;
    }

    return errorReturn;
  }
}
