---

### 📄 `docs/EXECUTION.md`

```markdown
# 🧪 Cronium Script Execution & Isolation

## Current State

- Users with permission can:
  - Execute commands on the **host server** via integrated terminal
  - Run events/scripts that also execute directly on the server
- Terminal built with `xterm.js` + `node-pty`
- Admins can toggle execution permission per user

---

## Security & Isolation Goals

**Goal:** No user scripts should run directly on the host system. All executions should be isolated in containers.

### Target Isolation Strategies

#### 🧱 LXC (Preferred)

- Create isolated containers per user/session/event
- Control CPU, memory, network, filesystem
- Pre-provisioned or ephemeral containers

#### 🐳 Docker (Alt. Option)

- Use `docker run` with:
  - Memory & CPU limits
  - Mounted volumes for input/output
  - Non-root users inside container

#### 🛑 chroot (Limited)

- Simple FS isolation, but lacks namespace separation
- Use with AppArmor/SELinux if necessary

---

## Terminal Execution Refactor

- Migrate from HTTP polling to **WebSocket-based** communication
- Wrap execution in container lifecycle:
  1. Prepare container
  2. Stream stdin/stdout
  3. Collect output + status
  4. Destroy container (if ephemeral)

---

## Sample Command Runner (Docker)

```ts
import { spawn } from "child_process";

export function runInDocker(script: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("docker", [
      "run",
      "--rm",
      "--cpus",
      "0.5",
      "--memory",
      "256m",
      "-i",
      "ubuntu",
      "bash",
      "-c",
      script,
    ]);

    let output = "";
    child.stdout.on("data", (data) => (output += data));
    child.stderr.on("data", (data) => (output += data));
    child.on("exit", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(`Exit ${code}: ${output}`));
    });
  });
}
```

### Planned Enhancements

- Container orchestration per user/event
- Role-based execution permissions
- Shared filesystem mounts for I/O
- Logs, auditing, and output retention
- Remote server execution via SSH remains unchanged
