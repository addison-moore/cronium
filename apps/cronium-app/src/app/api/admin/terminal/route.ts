import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { exec, execSync } from "child_process";
import { getServerSession } from "next-auth/next";
import { authOptions } from "@/lib/auth";
import { UserRole } from "@/shared/schema";
import { storage } from "@/server/storage";
import { terminalSSHService } from "@/lib/ssh/terminal";
import { decryptSensitiveData } from "@/lib/encryption-service";
import path from "path";
import fs from "fs";
import { promisify } from "util";

// Store the current directory for each user session (for local and remote)
const userSessions = new Map<string, string>();
const remoteUserSessions = new Map<string, string>();
const DEFAULT_DIR = process.cwd();

// Execute a shell command and return the result
const executeCommand = (
  command: string,
  cwd: string,
): Promise<{ stdout: string; stderr: string; cwd: string }> => {
  return new Promise((resolve) => {
    // Handle the cd command specially to track directory changes
    if (command.trim().startsWith("cd ")) {
      const newDir = command.trim().substring(3).trim();

      let targetDir = "";
      // Handle absolute paths
      if (newDir.startsWith("/")) {
        targetDir = newDir;
      }
      // Handle home directory
      else if (newDir === "~" || newDir.startsWith("~/")) {
        const homeDir = process.env.HOME ?? process.env.USERPROFILE ?? "/";
        targetDir =
          newDir === "~" ? homeDir : path.join(homeDir, newDir.substring(2));
      }
      // Handle parent directory
      else if (newDir === "..") {
        targetDir = path.dirname(cwd);
      }
      // Handle current directory
      else if (newDir === ".") {
        targetDir = cwd;
      }
      // Handle relative paths
      else {
        targetDir = path.join(cwd, newDir);
      }

      // Check if directory exists
      if (fs.existsSync(targetDir) && fs.statSync(targetDir).isDirectory()) {
        return resolve({ stdout: "", stderr: "", cwd: targetDir });
      } else {
        return resolve({
          stdout: "",
          stderr: `cd: ${newDir}: No such file or directory`,
          cwd,
        });
      }
    }

    // For other commands, execute in the current directory
    // Use user's default shell for local execution
    const userShell = process.env.SHELL ?? "/bin/bash";
    exec(
      command,
      {
        cwd,
        shell: userShell,
      },
      (error, stdout, stderr) => {
        if (error) {
          console.error(`Error executing command: ${command}`, error);
        }

        // Ensure consistent line endings and trim any trailing newlines
        let formattedStdout = stdout.replace(/\r\n/g, "\n");
        if (formattedStdout.endsWith("\n")) {
          formattedStdout = formattedStdout.slice(0, -1);
        }

        resolve({
          stdout: formattedStdout,
          stderr: stderr || (error ? error.message : ""),
          cwd,
        });
      },
    );
  });
};

// Helper function to get autocomplete suggestions
const getAutocompleteSuggestions = async (
  input: string,
  cwd: string,
): Promise<string[]> => {
  // If input is empty, no suggestions
  if (!input) return [];

  try {
    // Split the input into tokens (command and arguments)
    const tokens = input.split(" ");
    const lastToken = tokens[tokens.length - 1];

    // Guard against empty tokens
    if (!lastToken) return [];

    // If the input ends with a path, provide file/directory suggestions
    if (
      lastToken.includes("/") ||
      (tokens.length > 1 && !lastToken.startsWith("-"))
    ) {
      let basePath = "";
      let searchPattern = lastToken;

      // Handle absolute paths and relative paths
      if (lastToken.startsWith("/")) {
        // Absolute path
        const lastSlashIndex = lastToken.lastIndexOf("/");
        basePath = lastToken.substring(0, lastSlashIndex + 1) || "/";
        searchPattern = lastToken.substring(lastSlashIndex + 1);
      } else if (lastToken.includes("/")) {
        // Relative path with subdirectories
        const lastSlashIndex = lastToken.lastIndexOf("/");
        basePath = path.join(cwd, lastToken.substring(0, lastSlashIndex + 1));
        searchPattern = lastToken.substring(lastSlashIndex + 1);
      } else {
        // Simple filename in current directory
        basePath = cwd;
        searchPattern = lastToken;
      }

      // Get list of files/directories in the base path
      try {
        const entries = fs.readdirSync(basePath);
        return entries
          .filter((entry) => entry.startsWith(searchPattern))
          .map((entry) => {
            // Check if it's a directory and append '/' if it is
            const fullPath = path.join(basePath, entry);
            const isDir = fs.statSync(fullPath).isDirectory();

            // Replace the last token with the suggestion
            const tokensCopy = [...tokens];
            tokensCopy[tokensCopy.length - 1] =
              lastToken.substring(0, lastToken.length - searchPattern.length) +
              entry +
              (isDir ? "/" : "");

            return tokensCopy.join(" ");
          });
      } catch (error) {
        console.error("Error getting autocomplete suggestions:", error);
        return [];
      }
    }

    // First token (command suggestion from PATH)
    if (tokens.length === 1) {
      try {
        // First check if compgen is available
        try {
          // Check if compgen is available by running a simple test
          const execPromise = promisify(exec);
          await execPromise("which compgen");

          try {
            // Use compgen command (bash built-in) for command completion
            const { stdout } = await execPromise(
              `compgen -c "${lastToken}" | sort | uniq`,
            );

            // Return unique commands
            const commands = stdout
              .split("\n")
              .filter(Boolean)
              .map((cmd) => cmd.trim());

            return commands;
          } catch (error) {
            // Fallback if compgen fails
            console.error("Error using compgen:", error);
            throw error; // Use the fallback below
          }
        } catch (error) {
          console.error("Failed to get available commands:", error);
          // Fallback when compgen is not available: use common commands list
          console.info(
            "Compgen not available or error occurred, using common commands list",
          );

          // Use a predefined list of common commands
          const commonCommands = [
            "ls",
            "cd",
            "pwd",
            "mkdir",
            "rm",
            "cp",
            "mv",
            "cat",
            "grep",
            "find",
            "echo",
            "touch",
            "chmod",
            "chown",
            "ps",
            "top",
            "df",
            "du",
            "tar",
            "zip",
            "unzip",
            "ssh",
            "scp",
            "curl",
            "wget",
            "apt",
            "apt-get",
            "yum",
            "dnf",
            "pip",
            "npm",
            "node",
            "python",
            "git",
            "nano",
            "vim",
            "sudo",
            "man",
            "less",
            "more",
            "head",
            "tail",
            "wc",
            "sort",
            "uniq",
            "awk",
            "sed",
          ];

          // Filter commands that start with the typed token
          return commonCommands.filter((cmd) => cmd.startsWith(lastToken));
        }
      } catch (error) {
        console.error("Error getting command suggestions:", error);
        return [];
      }
    }

    return [];
  } catch (error) {
    console.error("Error in autocomplete:", error);
    return [];
  }
};

// Create a POST endpoint to handle terminal commands
export async function POST(req: NextRequest): Promise<NextResponse> {
  try {
    // Check if user is authenticated and is an admin
    const session = await getServerSession(authOptions);
    if (!session || session.user.role !== UserRole.ADMIN) {
      return NextResponse.json(
        { error: "Unauthorized: Admin access required" },
        { status: 403 },
      );
    }

    // Get user ID to maintain separate session state
    const userId = session.user.id || "default";

    // Get command and current path from request body
    const body: unknown = await req.json();
    const { command, currentPath, autocompleteRequest, serverId } = body as {
      command?: string;
      currentPath?: string;
      autocompleteRequest?: string;
      serverId?: number;
    };

    // Handle remote server execution
    if (serverId) {
      try {
        // Get server information
        const servers = await storage.getAllServers(userId);
        const server = servers.find((s) => s.id === serverId);
        if (!server) {
          return NextResponse.json(
            { error: "Server not found" },
            { status: 404 },
          );
        }

        const sessionKey = `${String(userId)}-${String(serverId)}`;
        const remoteCwd = remoteUserSessions.get(sessionKey) ?? "~";

        // Handle autocomplete request for remote server
        if (autocompleteRequest) {
          // For now, return empty suggestions for remote servers
          // This could be enhanced to support remote autocomplete
          return NextResponse.json({
            suggestions: [],
            currentPath: remoteCwd,
          });
        }

        // Handle connection prewarming request (when no command is provided)
        if (!command) {
          // Prewarm the connection when terminal is first opened for this server
          const decryptedServer = decryptSensitiveData(server, "servers");
          // Determine auth type and credential
          const authCredential =
            decryptedServer.sshKey ?? decryptedServer.password ?? "";
          const authType = decryptedServer.sshKey ? "privateKey" : "password";
          await terminalSSHService.prewarmConnection(
            server.address,
            authCredential,
            server.username,
            server.port,
            authType,
          );

          // Get the actual shell prompt from the remote server
          const actualPrompt = await terminalSSHService.getShellPrompt(
            server.address,
            authCredential,
            server.username,
            server.port,
            remoteCwd,
            authType,
          );

          return NextResponse.json({
            success: true,
            output: "",
            error: "",
            currentPath: remoteCwd,
            prompt: actualPrompt,
          });
        }

        // Decrypt the authentication credentials for secure connection
        const decryptedServer = decryptSensitiveData(server, "servers");
        // Determine auth type and credential
        const authCredential =
          decryptedServer.sshKey ?? decryptedServer.password ?? "";
        const authType = decryptedServer.sshKey ? "privateKey" : "password";

        // For cd commands, try to track directory changes
        let newRemoteCwd = remoteCwd;

        // Execute the command on the remote server using pooled connection
        try {
          const result = await terminalSSHService.executeCommand(
            server.address,
            authCredential,
            server.username,
            server.port,
            String(command),
            remoteCwd,
            authType,
          );
          // For cd commands, get the actual working directory after execution
          if (String(command).trim().startsWith("cd ")) {
            try {
              const pwdResult = await terminalSSHService.executeCommand(
                server.address,
                authCredential,
                server.username,
                server.port,
                "pwd",
                remoteCwd,
                authType,
              );
              if (pwdResult.stdout && !pwdResult.stderr) {
                newRemoteCwd = String(pwdResult.stdout).trim();
              }
            } catch (pwdError) {
              console.error(
                "Failed to get current directory after cd:",
                pwdError,
              );
            }
          }

          // Update the remote session
          remoteUserSessions.set(sessionKey, newRemoteCwd);

          // Get the updated shell prompt after command execution
          const updatedPrompt = await terminalSSHService.getShellPrompt(
            server.address,
            authCredential,
            server.username,
            server.port,
            newRemoteCwd,
            authType,
          );

          return NextResponse.json({
            success: true,
            output: result.stdout,
            error: result.stderr,
            currentPath: newRemoteCwd,
            prompt: updatedPrompt,
          });
        } catch (sshError) {
          console.error("SSH connection/execution error:", sshError);
          return NextResponse.json({
            success: false,
            output: "",
            error: `SSH Error: ${sshError instanceof Error ? sshError.message : "Connection failed"}`,
            currentPath: newRemoteCwd,
            prompt: `${server.username}@${server.name}:${newRemoteCwd}$ `,
          });
        }
      } catch (error) {
        console.error("Remote terminal error:", error);
        return NextResponse.json(
          { error: "Failed to execute command on remote server" },
          { status: 500 },
        );
      }
    }

    // Handle local server execution (existing logic)
    const cwd = userSessions.get(userId) ?? currentPath ?? DEFAULT_DIR;

    // Handle autocomplete request
    if (autocompleteRequest) {
      const suggestions = await getAutocompleteSuggestions(
        String(autocompleteRequest),
        String(cwd),
      );
      return NextResponse.json({
        suggestions,
        currentPath: cwd,
      });
    }

    if (!command) {
      return NextResponse.json(
        { error: "Command is required" },
        { status: 400 },
      );
    }

    // Execute the command and get results
    const {
      stdout,
      stderr,
      cwd: newCwd,
    } = await executeCommand(String(command), String(cwd));

    // Update the current directory in the session
    userSessions.set(userId, newCwd);

    // Get the actual username and hostname
    let username = "";
    let hostname = "";

    try {
      // Use whoami to get the current user
      username = String(execSync("whoami")).trim();

      // Use hostname to get the current machine name
      hostname = String(execSync("hostname")).trim();
    } catch (error) {
      // Fallback values if commands fail
      username = "user";
      hostname = "server";
      console.error("Error getting system info:", error);
    }

    // Use default values if empty
    if (!username) username = "user";
    if (!hostname) hostname = "server";

    // Format the path for display
    const displayPath =
      newCwd === DEFAULT_DIR ? "~" : newCwd.replace(DEFAULT_DIR, "~");

    // Return the command output and the new current directory
    return NextResponse.json({
      success: true,
      output: stdout,
      error: stderr,
      currentPath: newCwd,
      prompt: `${username}@${hostname}:${displayPath}$ `,
    });
  } catch (error) {
    console.error("Terminal API error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
