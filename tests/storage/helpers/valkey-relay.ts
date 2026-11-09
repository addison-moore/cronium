import net from "node:net";

/**
 * A TCP relay in front of the real Valkey that a test can stop and start again. Stopping
 * refuses new connections and drops the open ones, which is what `docker stop` does to a
 * client, so the app's own ioredis client sees a real ECONNRESET and ECONNREFUSED. The real
 * server stays up, so a test can still look at what's in it, and the rest of the suite can
 * use it.
 */
export interface ValkeyRelay {
  /** VALKEY_URL for whatever should connect through the relay. */
  url: string;
  stop(): Promise<void>;
  /** Listens again, on the same port. */
  start(): Promise<void>;
}

export async function relayTo(valkeyUrl: string): Promise<ValkeyRelay> {
  const target = new URL(valkeyUrl);
  const open = new Set<net.Socket>();
  let server: net.Server | null = null;
  let port = 0;

  function relay(client: net.Socket): void {
    const upstream = net.connect(Number(target.port || 6379), target.hostname);
    open.add(client);
    open.add(upstream);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      open.delete(client);
      open.delete(upstream);
    };
    client.on("error", drop).on("close", drop);
    upstream.on("error", drop).on("close", drop);
    client.pipe(upstream).pipe(client);
  }

  const start = () =>
    new Promise<void>((resolve, reject) => {
      const listening = net.createServer(relay);
      listening.once("error", reject);
      listening.listen(port, "127.0.0.1", () => {
        port = (listening.address() as net.AddressInfo).port;
        server = listening;
        resolve();
      });
    });

  const stop = async () => {
    const listening = server;
    server = null;
    for (const socket of open) socket.destroy();
    open.clear();
    if (listening) {
      await new Promise<void>((resolve) => listening.close(() => resolve()));
    }
  };

  await start();
  const url = new URL(valkeyUrl);
  url.hostname = "127.0.0.1";
  url.port = String(port);
  return { url: url.toString(), stop, start };
}
