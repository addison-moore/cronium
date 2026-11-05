"use client";

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

/**
 * Self-host the Monaco editor (security plan Phase 1.6).
 *
 * Left unconfigured, @monaco-editor/react injects
 * `<script src="https://cdn.jsdelivr…/loader.js">` to run Monaco's AMD build
 * from the CDN. The production Content-Security-Policy blocks that script, so
 * the editor would never render.
 *
 * Giving the loader this bundled copy keeps Monaco's JavaScript, CSS and fonts
 * in the app's own webpack output, so none of them leave our origin.
 *
 * Importing this module downloads all of Monaco, so it must stay behind the
 * dynamic import registered with `setMonacoSetup` in Providers.tsx.
 */

let configured = false;

export function setupMonaco(): void {
  if (configured || typeof window === "undefined") return;
  configured = true;

  loader.config({ monaco });

  // Each `new Worker(new URL(...))` must stay a literal so webpack can see it
  // and bundle the worker. The paths go through monaco-editor's `exports` map,
  // which already prefixes `esm/vs/`. The chunks are served from our origin,
  // which `worker-src 'self'` allows.
  (
    window as unknown as { MonacoEnvironment?: monaco.Environment }
  ).MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      switch (label) {
        case "json":
          return new Worker(
            new URL(
              "monaco-editor/language/json/json.worker.js",
              import.meta.url,
            ),
          );
        case "css":
        case "scss":
        case "less":
          return new Worker(
            new URL(
              "monaco-editor/language/css/css.worker.js",
              import.meta.url,
            ),
          );
        case "html":
        case "handlebars":
        case "razor":
          return new Worker(
            new URL(
              "monaco-editor/language/html/html.worker.js",
              import.meta.url,
            ),
          );
        case "typescript":
        case "javascript":
          return new Worker(
            new URL(
              "monaco-editor/language/typescript/ts.worker.js",
              import.meta.url,
            ),
          );
        default:
          return new Worker(
            new URL("monaco-editor/editor/editor.worker.js", import.meta.url),
          );
      }
    },
  };
}
