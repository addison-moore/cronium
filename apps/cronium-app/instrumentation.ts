/**
 * Next.js Instrumentation
 * This file is loaded once when the server starts, before any pages or API routes.
 * It's the perfect place to initialize plugins that need to be available globally.
 */

export async function register() {
  console.log("[Instrumentation] Initializing server...");

  if (process.env.NEXT_RUNTIME === "nodejs") {
    // Server-side initialization
    console.log(
      "[Instrumentation] Node.js runtime detected, initializing plugins...",
    );

    // Initialize tool plugins
    const { initializePlugins } = await import("@/tools/plugins");
    initializePlugins();

    console.log("[Instrumentation] Server initialization complete");
  }

  if (process.env.NEXT_RUNTIME === "edge") {
    // Edge runtime initialization
    console.log("[Instrumentation] Edge runtime detected");
  }
}
