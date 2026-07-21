/**
 * Security plan Phase 1.1: route-by-role/capability inventory.
 *
 * Statically scans every tRPC router source file for mutation procedures and
 * fails when a mutation exists without a declared capability in
 * ROUTE_CAPABILITIES (or when the inventory contains stale entries). This is
 * the CI gate that forces every new state-changing route to declare the
 * capability it exercises; runtime enforcement lives in trpc.ts
 * (enforceRouteCapability), which treats undeclared mutations as `edit` so
 * they still deny read-only roles.
 *
 * The scan is intentionally source-based (no runtime import of the app router)
 * so it cannot trigger database/Valkey connections in CI.
 */
import fs from "node:fs";
import path from "node:path";

import { ROUTE_CAPABILITIES } from "@/server/security/route-capabilities";

const API_DIR = path.resolve(
  __dirname,
  "../../apps/cronium-app/src/server/api",
);

/** Map `routerVariable` → resolved absolute source path, from import lines. */
function routerImports(source: string, fromDir: string): Map<string, string> {
  const imports = new Map<string, string>();
  const importRegex =
    /import\s*{\s*([A-Za-z0-9_]+)\s*}\s*from\s*"(\.[^"]+)";/g;
  for (const match of source.matchAll(importRegex)) {
    const [, name, relative] = match;
    if (!name || !relative || !name.endsWith("Router")) continue;
    const resolved = path.resolve(fromDir, `${relative}.ts`);
    if (fs.existsSync(resolved)) imports.set(name, resolved);
  }
  return imports;
}

/**
 * Extract procedure names that end in `.mutation(` from a router source file,
 * plus nested router mounts (`key: someRouter,`). Procedure/mount properties
 * sit at exactly two-space indentation inside `createTRPCRouter({ ... })`;
 * zod schema fields and other nested objects are indented deeper.
 */
function scanRouterFile(filePath: string): {
  mutations: string[];
  mounts: Array<{ key: string; routerVar: string }>;
} {
  const source = fs.readFileSync(filePath, "utf8");
  const mutations: string[] = [];
  const mounts: Array<{ key: string; routerVar: string }> = [];

  let currentProcedure: string | null = null;
  for (const line of source.split("\n")) {
    const property = /^ {2}([A-Za-z0-9_$]+):\s*(\S+)/.exec(line);
    if (property?.[1] && property[2]) {
      const value = property[2].replace(/,+$/, "");
      if (/^[A-Za-z0-9_$]+Router$/.test(value)) {
        mounts.push({ key: property[1], routerVar: value });
        currentProcedure = null;
        continue;
      }
      currentProcedure = property[1];
    }
    if (line.includes(".mutation(") && currentProcedure) {
      mutations.push(currentProcedure);
      currentProcedure = null;
    }
  }
  return { mutations, mounts };
}

/** Recursively collect fully-qualified mutation paths for a router file. */
function collectMutationPaths(filePath: string, prefix: string): string[] {
  const { mutations, mounts } = scanRouterFile(filePath);
  const source = fs.readFileSync(filePath, "utf8");
  const imports = routerImports(source, path.dirname(filePath));

  const paths = mutations.map((name) =>
    prefix ? `${prefix}.${name}` : name,
  );
  for (const mount of mounts) {
    const nestedFile = imports.get(mount.routerVar);
    if (!nestedFile) continue;
    const nestedPrefix = prefix ? `${prefix}.${mount.key}` : mount.key;
    paths.push(...collectMutationPaths(nestedFile, nestedPrefix));
  }
  return paths;
}

function discoverAllMutationPaths(): string[] {
  const rootSource = fs.readFileSync(path.join(API_DIR, "root.ts"), "utf8");
  const imports = routerImports(rootSource, API_DIR);

  const appRouterBlock = /createTRPCRouter\(\{([\s\S]*?)\}\);/.exec(
    rootSource,
  );
  if (!appRouterBlock?.[1]) {
    throw new Error("Could not locate appRouter definition in root.ts");
  }

  const paths: string[] = [];
  const mountRegex = /^ {2}([A-Za-z0-9_$]+):\s*([A-Za-z0-9_$]+Router),/gm;
  for (const match of appRouterBlock[1].matchAll(mountRegex)) {
    const [, mount, routerVar] = match;
    if (!mount || !routerVar) continue;
    const file = imports.get(routerVar);
    if (!file) {
      throw new Error(`Cannot resolve source file for ${routerVar}`);
    }
    paths.push(...collectMutationPaths(file, mount));
  }
  return [...new Set(paths)].sort();
}

describe("route capability inventory", () => {
  const discovered = discoverAllMutationPaths();

  it("discovers a sane number of mutations (scanner self-check)", () => {
    // If the scanner regresses to finding almost nothing, the coverage
    // guarantees below become meaningless — fail loudly instead.
    expect(discovered.length).toBeGreaterThan(60);
    expect(discovered).toEqual(
      expect.arrayContaining([
        "events.create",
        "events.execute",
        "workflows.execute",
        "admin.updateUser",
        "tools.slack.send",
        "userAuth.login",
      ]),
    );
  });

  it("every mutation declares a capability (deny-by-default inventory)", () => {
    const undeclared = discovered.filter(
      (route) => !(route in ROUTE_CAPABILITIES),
    );
    expect(undeclared).toEqual([]);
  });

  it("the inventory contains no stale entries", () => {
    const discoveredSet = new Set(discovered);
    const stale = Object.keys(ROUTE_CAPABILITIES).filter(
      (route) => !discoveredSet.has(route),
    );
    expect(stale).toEqual([]);
  });

  it("admin routes require the admin capability", () => {
    for (const route of discovered.filter((r) => r.startsWith("admin."))) {
      expect(`${route}=${ROUTE_CAPABILITIES[route]}`).toBe(`${route}=admin`);
    }
  });

  it("execution routes are marked execute or use-secret", () => {
    for (const route of [
      "events.execute",
      "workflows.execute",
      "tools.executeAction",
      "servers.testConnection",
    ]) {
      expect(["execute", "use-secret"]).toContain(ROUTE_CAPABILITIES[route]);
    }
  });
});
