"use client";

import { loader } from "@monaco-editor/react";
import * as monaco from "monaco-editor";

/**
 * Self-host the Monaco editor (security plan Phase 1.6).
 *
 * By default @monaco-editor/react injects a `<script src="https://cdn.jsdelivr…">`
 * to load Monaco. That external, non-nonced script is blocked by the
 * production Content-Security-Policy (`script-src 'self' 'nonce-…'
 * 'strict-dynamic'`), which would break the editor. Pointing the loader at the
 * bundled `monaco-editor` package removes the CDN dependency entirely, so
 * Monaco is served from our own origin and picks up the nonce automatically.
 *
 * Web workers are served from same-origin blob URLs (`worker-src 'self' blob:`
 * in the CSP). If a worker cannot be created, Monaco degrades gracefully to
 * running language services on the main thread.
 */

let configured = false;

export function setupMonaco(): void {
  if (configured || typeof window === "undefined") return;
  configured = true;

  loader.config({ monaco });

  // Route language workers to same-origin bundles instead of the CDN.
  (
    window as unknown as { MonacoEnvironment?: monaco.Environment }
  ).MonacoEnvironment = {
    getWorker(_workerId: string, label: string): Worker {
      const base = "monaco-editor/esm/vs";
      switch (label) {
        case "json":
          return new Worker(
            new URL(`${base}/language/json/json.worker`, import.meta.url),
          );
        case "typescript":
        case "javascript":
          return new Worker(
            new URL(`${base}/language/typescript/ts.worker`, import.meta.url),
          );
        default:
          return new Worker(
            new URL(`${base}/editor/editor.worker`, import.meta.url),
          );
      }
    },
  };
}
