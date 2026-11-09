"use client";

import { useCallback, useEffect, useState } from "react";
import { type ToolPlugin, ToolPluginRegistry } from "@/tools/types/tool-plugin";

export type ToolPluginsStatus = "loading" | "ready" | "failed";

// One array rather than a new one each render: callers depend on its identity.
const NO_PLUGINS: ToolPlugin[] = [];

/**
 * The tool plugins, loaded the first time something on the page needs them.
 *
 * They register when `@/tools/plugins` is imported, and that module brings every
 * plugin's forms and actions with it. A static import from a page's component would
 * make everyone opening the page download them, and most events aren't tool actions,
 * so this imports them when it mounts. A page that has already loaded them, such as
 * the Tools page before a client-side navigation, has nothing to wait for.
 *
 * Don't import `@/tools/plugins` statically from anything else on a page that doesn't
 * always need it, and keep its modules out of `commons` in next.config.mjs, or every
 * page pays for them after all. `tests/e2e/bundle.test.ts` checks both.
 */
export function useToolPlugins(): {
  plugins: ToolPlugin[];
  status: ToolPluginsStatus;
  retry: () => void;
} {
  const [plugins, setPlugins] = useState<ToolPlugin[] | null>(() => {
    const registered = ToolPluginRegistry.getAll();
    return registered.length > 0 ? registered : null;
  });
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (plugins) return;
    let current = true;
    import(/* webpackChunkName: "tool-plugins" */ "@/tools/plugins")
      .then(({ ToolPluginRegistry: registry }) => {
        if (current) setPlugins(registry.getAll());
      })
      .catch((error: unknown) => {
        console.error("Failed to load the tool plugins:", error);
        if (current) setFailed(true);
      });
    return () => {
      current = false;
    };
  }, [plugins, attempt]);

  const retry = useCallback(() => {
    setFailed(false);
    setAttempt((count) => count + 1);
  }, []);

  return {
    plugins: plugins ?? NO_PLUGINS,
    status: plugins ? "ready" : failed ? "failed" : "loading",
    retry,
  };
}
