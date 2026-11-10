import net from "node:net";

/**
 * A TCP relay in front of the real Valkey that a test can make stop answering, as Valkey
 * does when its container is paused or the network drops its packets: connections stay
 * open and new ones are accepted, and nothing sent on them gets an answer.
 *
 * - `pause()` holds what's sent, as a paused container's kernel does, and `resume()`
 *   delivers it.
 * - `drop()` throws away what's sent, as a network that loses packets does, and
 *   `restore()` lets new connections through again. A connection made before stays
 *   unanswered.
 * - `stop()` refuses new connections and drops the open ones, as `docker stop` does to a
 *   client, and `start()` listens again on the same port, if it isn't already.
 *
 * The real Valkey stays up, so a test can look at what reached it.
 */
export interface QuietRelay {
  /** VALKEY_URL for whatever should connect through the relay. */
  url: string;
  pause(): void;
  resume(): void;
  drop(): void;
  restore(): void;
  stop(): Promise<void>;
  start(): Promise<void>;
  /** Connections accepted since the relay started. */
  accepted(): number;
  close(): Promise<void>;
}

interface Pair {
  client: net.Socket;
  upstream: net.Socket | null;
  dropping: boolean;
}

export async function quietRelayTo(valkeyUrl: string): Promise<QuietRelay> {
  const target = new URL(valkeyUrl);
  const pairs = new Set<Pair>();
  let server: net.Server | null = null;
  let port = 0;
  let paused = false;
  let dropping = false;
  let accepted = 0;

  const end = (pair: Pair) => {
    pair.client.destroy();
    pair.upstream?.destroy();
    pairs.delete(pair);
  };

  function connectUpstream(pair: Pair): void {
    const upstream = net.connect(Number(target.port || 6379), target.hostname);
    pair.upstream = upstream;
    upstream.on("data", (chunk) => {
      if (!pair.dropping) pair.client.write(chunk);
    });
    upstream.on("error", () => end(pair)).on("close", () => end(pair));
    pair.client.on("data", (chunk) => {
      if (!pair.dropping) upstream.write(chunk);
    });
  }

  function accept(client: net.Socket): void {
    accepted += 1;
    const pair: Pair = { client, upstream: null, dropping };
    pairs.add(pair);
    client.on("error", () => end(pair)).on("close", () => end(pair));
    if (pair.dropping) {
      // Read and forget, so nothing ever comes back.
      client.on("data", () => undefined);
      return;
    }
    if (paused) {
      client.pause();
      return;
    }
    connectUpstream(pair);
  }

  const start = () =>
    new Promise<void>((resolve, reject) => {
      if (server) return resolve();
      const listening = net.createServer(accept);
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
    for (const pair of [...pairs]) end(pair);
    if (listening) {
      await new Promise<void>((resolve) => listening.close(() => resolve()));
    }
  };

  await start();
  const url = new URL(valkeyUrl);
  url.hostname = "127.0.0.1";
  url.port = String(port);

  return {
    url: url.toString(),
    pause() {
      paused = true;
      for (const pair of pairs) {
        pair.client.pause();
        pair.upstream?.pause();
      }
    },
    resume() {
      paused = false;
      for (const pair of pairs) {
        if (pair.dropping) continue;
        if (!pair.upstream) connectUpstream(pair);
        pair.upstream!.resume();
        pair.client.resume();
      }
    },
    drop() {
      dropping = true;
      for (const pair of pairs) pair.dropping = true;
    },
    restore() {
      dropping = false;
    },
    stop,
    start,
    accepted: () => accepted,
    close: async () => {
      paused = false;
      await stop();
    },
  };
}

/** A listener that accepts connections and never says anything on them. */
export async function silentListener(): Promise<{
  url: string;
  accepted: () => number;
  close: () => Promise<void>;
}> {
  const held = new Set<net.Socket>();
  let accepted = 0;
  const server = net.createServer((socket) => {
    accepted += 1;
    held.add(socket);
    socket.on("error", () => undefined);
    socket.on("close", () => held.delete(socket));
  });
  await new Promise<void>((resolve) =>
    server.listen(0, "127.0.0.1", () => resolve()),
  );
  const { port } = server.address() as net.AddressInfo;
  return {
    url: `redis://127.0.0.1:${port}`,
    accepted: () => accepted,
    close: () =>
      new Promise<void>((resolve) => {
        for (const socket of held) socket.destroy();
        server.close(() => resolve());
      }),
  };
}
