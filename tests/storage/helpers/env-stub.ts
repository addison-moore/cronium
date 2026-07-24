/**
 * Runtime stub for `@/env.mjs` (mapped in the Storage Tests project's
 * moduleNameMapper). The real env.mjs is an ESM `.mjs` that pulls in
 * @t3-oss/env-nextjs (ESM-only); ts-jest transforms neither. The suites set the
 * needed vars in the harness + setup.ts before anything loads, so a
 * pass-through over process.env is faithful (with the one default the app
 * relies on). Type-checking still resolves the real env.mjs via tsconfig paths,
 * so consumers keep their real types.
 */
export const env = new Proxy(
  {},
  {
    get(_target, prop: string) {
      if (prop === "ORCHESTRATOR_URL") {
        return process.env.ORCHESTRATOR_URL ?? "http://orchestrator:8080";
      }
      return process.env[prop];
    },
  },
) as unknown as Record<string, string | undefined>;
