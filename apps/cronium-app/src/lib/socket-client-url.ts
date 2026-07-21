interface SocketBrowserLocation {
  protocol: string;
  hostname: string;
  origin: string;
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "::1" ||
    hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(hostname)
  );
}

function formatHost(hostname: string): string {
  return hostname.includes(":") && !hostname.startsWith("[")
    ? `[${hostname}]`
    : hostname;
}

/**
 * Public deployments use the page origin so only a reverse-proxied
 * /api/socketio route is browser reachable. Raw port 5002 is reserved for
 * loopback development and local installs.
 */
export function resolveSocketClientUrl(
  location: SocketBrowserLocation,
  configuredUrl = process.env.NEXT_PUBLIC_SOCKET_URL,
  configuredPort = process.env.NEXT_PUBLIC_SOCKET_PORT,
): string {
  const explicitUrl = configuredUrl?.trim();
  if (explicitUrl) return explicitUrl.replace(/\/$/, "");

  if (location.protocol === "http:" && isLoopbackHost(location.hostname)) {
    const port = configuredPort?.trim() ?? "5002";
    return `${location.protocol}//${formatHost(location.hostname)}:${port}`;
  }

  return location.origin;
}
