/**
 * A proxy to a database that can stop answering without closing anything:
 * connections stay open, and what goes in gets no reply. Refusing connections would
 * be a different and much easier failure, and pausing the real one would stop every
 * other test using it.
 */
import net from "node:net";

export async function hangableDatabase(databaseUrl: string) {
  const target = new URL(databaseUrl);
  const stopRelaying: Array<() => void> = [];
  const sockets = new Set<net.Socket>();
  let hung = false;

  const proxy = net.createServer((client) => {
    client.on("error", () => undefined);
    sockets.add(client);
    if (hung) return;

    const server = net.connect(Number(target.port), target.hostname);
    server.on("error", () => undefined);
    sockets.add(server);
    client.pipe(server);
    server.pipe(client);
    stopRelaying.push(() => {
      client.unpipe(server);
      server.unpipe(client);
      client.pause();
      server.pause();
    });
  });
  await new Promise<void>((resolve) => proxy.listen(0, "127.0.0.1", resolve));

  const url = new URL(databaseUrl);
  url.hostname = "127.0.0.1";
  url.port = String((proxy.address() as net.AddressInfo).port);

  return {
    url: url.toString(),
    hang: () => {
      hung = true;
      stopRelaying.forEach((stop) => stop());
    },
    /**
     * New connections work again, and those already open stay silent for good: what a
     * failover, or a firewall that has forgotten them, leaves behind.
     */
    acceptNewConnections: () => {
      hung = false;
    },
    close: () => {
      sockets.forEach((socket) => socket.destroy());
      proxy.close();
    },
  };
}
