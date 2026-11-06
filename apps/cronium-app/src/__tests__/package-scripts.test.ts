/**
 * @jest-environment node
 */
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

// These scripts load env/.env.local through a CLI named on the command line.
// pnpm links one package per bin name, so a dependency that starts publishing
// the same name silently replaces that CLI. dotenv@18 added a `dotenv` bin, and
// the scripts began exiting with its usage message. Nothing else runs them: CI
// and the Docker image call `next build` directly.
const appDir = resolve(__dirname, "../..");
const { scripts } = JSON.parse(
  readFileSync(join(appDir, "package.json"), "utf8"),
) as { scripts: Record<string, string> };

describe("package scripts that load env/.env.local", () => {
  let tempDir: string;
  let envFile: string;

  beforeAll(() => {
    tempDir = mkdtempSync(join(tmpdir(), "cronium-package-scripts-"));
    envFile = join(tempDir, ".env.test");
    writeFileSync(envFile, "CRONIUM_ENV_PROBE=loaded\n");
  });

  afterAll(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it.each(["dev", "build", "start"])(
    "`%s` runs its command through a CLI that loads the env file",
    (name) => {
      const [bin = "", flag = "", file, separator = ""] = (
        scripts[name] ?? ""
      ).split(" ");
      expect(file).toBe("../../env/.env.local");

      // The same binary and flags as the script, with a probe as the command.
      const output = execFileSync(
        join(appDir, "node_modules", ".bin", bin),
        [
          flag,
          envFile,
          separator,
          process.execPath,
          "-p",
          "process.env.CRONIUM_ENV_PROBE",
        ],
        { encoding: "utf8" },
      );

      expect(output.trim()).toBe("loaded");
    },
  );
});
