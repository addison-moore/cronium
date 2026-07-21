/**
 * CommonJS stand-in for the ESM-only `superjson` package. The cross-cutting
 * Jest projects use ts-jest (no SWC pipeline like the app's next/jest config),
 * which cannot load superjson's ESM dist. Server-side tRPC callers never
 * exercise the transformer, so passthrough semantics are sufficient here.
 */
const superjson = {
  stringify: (value: unknown): string => JSON.stringify(value),
  parse: (value: string): unknown => JSON.parse(value),
  serialize: (value: unknown): { json: unknown } => ({ json: value }),
  deserialize: (payload: { json: unknown }): unknown => payload.json,
};

export default superjson;
export const { stringify, parse, serialize, deserialize } = superjson;
