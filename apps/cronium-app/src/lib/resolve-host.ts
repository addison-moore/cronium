/**
 * Resolving a hostname a tenant chose, without using libuv's thread pool.
 *
 * `dns.lookup` is getaddrinfo, which blocks a pool thread until the name server
 * answers or the resolver gives up, and nothing can cancel it. libuv gives lookups half
 * of the pool, 2 threads by default, and every other lookup in the process waits behind
 * them, including the ones that connect to Postgres and Valkey by service name. On the
 * published image a host whose name server never answers holds a thread for 5 seconds,
 * so two such hosts at a time are enough to stop those connections, and the pool's 2
 * second connect limit then fails them. c-ares waits on a socket, so a host like that
 * costs only its own request.
 *
 * What getaddrinfo also did:
 * - It reads /etc/hosts first, so this does too.
 * - Docker service names need nothing here: the name server in a compose network's
 *   resolv.conf is the one that answers them.
 * - It tries search domains. This doesn't, so a name that only resolves through one
 *   fails. A name that resolves to an internal address is refused either way, so what's
 *   lost is a short name for a public host.
 *
 * Server-only: it imports fs and dns.
 */
import type { LookupAddress } from "dns";
import { Resolver } from "dns/promises";
import { readFileSync } from "fs";
import net from "net";

const HOSTS_FILE = "/etc/hosts";

/**
 * How long a name server gets. c-ares gives the second try between one and two times
 * as long as the first, and Node checks on it once a second, so a server that never
 * answers takes 6 to 8 seconds in all, and three of them about 20, because they're
 * tried in turn. getaddrinfo gives up after 5 on the published image, resending at 2.5,
 * so anything a working resolver answers within that still gets through: c-ares drops
 * a late answer to its first try, but a resolver with a cache answers the second at
 * once. One with no cache that takes over 3 seconds every time can now fail.
 */
const FIRST_TRY_MS = 2_500;
const TRIES = 2;

/**
 * Read on every lookup, as getaddrinfo does on the published image, and synchronously
 * because the file is a few hundred bytes and `fs.promises` would queue for the threads
 * this module exists to stay off.
 */
function addressesInHostsFile(hostname: string): LookupAddress[] {
  let text: string;
  try {
    text = readFileSync(HOSTS_FILE, "utf8");
  } catch {
    return [];
  }

  const wanted = hostname.toLowerCase();
  const found: LookupAddress[] = [];
  for (const line of text.split("\n")) {
    const [address = "", ...names] = line
      .replace(/#.*/, "")
      .trim()
      .split(/\s+/);
    const family = net.isIP(address);
    if (family && names.some((name) => name.toLowerCase() === wanted)) {
      found.push({ address, family });
    }
  }
  return found;
}

/** A name or a record that doesn't exist is an answer. Anything else isn't. */
function noRecords(error: NodeJS.ErrnoException): string[] {
  if (error.code === "ENOTFOUND" || error.code === "ENODATA") return [];
  throw error;
}

/**
 * Every address a host resolves to, IPv4 first, or none if it has none.
 *
 * Rejects if the name server doesn't answer for either family, even if it did for the
 * other. A caller checking every address can't check one it wasn't told about, and
 * getaddrinfo on the published image fails the same way.
 *
 * A Resolver for each lookup reads resolv.conf each time, as getaddrinfo does on the
 * published image, and adds about 0.1 ms.
 */
export async function resolveHost(hostname: string): Promise<LookupAddress[]> {
  const fromHostsFile = addressesInHostsFile(hostname);
  if (fromHostsFile.length > 0) return fromHostsFile;

  const resolver = new Resolver({ timeout: FIRST_TRY_MS, tries: TRIES });
  const [v4, v6] = await Promise.all([
    resolver.resolve4(hostname).catch(noRecords),
    resolver.resolve6(hostname).catch(noRecords),
  ]);
  return [
    ...v4.map((address) => ({ address, family: 4 })),
    ...v6.map((address) => ({ address, family: 6 })),
  ];
}
