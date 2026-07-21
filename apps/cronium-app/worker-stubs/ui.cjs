/**
 * @cronium/ui stub for the worker bundle.
 *
 * Tool plugins are .tsx modules that carry both their server-side execute()
 * logic and their configuration UI; importing them (initializePlugins) drags
 * `@cronium/ui` into the worker's module graph. That package is untranspiled
 * workspace TypeScript resolved by Next's compiler — plain Node cannot load
 * it, and the worker must never render UI anyway. esbuild aliases
 * `@cronium/ui` to this Proxy, which satisfies any named import with an inert
 * component/function.
 *
 * If a worker code path ever actually CALLS into UI, that's a bug — the
 * render below makes it loud instead of silently returning null.
 */

const inert = new Proxy(function stubComponent() {
  throw new Error(
    "@cronium/ui was invoked inside the scheduling worker — server code must not render UI",
  );
}, {
  get(_target, prop) {
    if (prop === "__esModule") return true;
    return inert;
  },
  apply() {
    throw new Error(
      "@cronium/ui was invoked inside the scheduling worker — server code must not render UI",
    );
  },
});

module.exports = inert;
