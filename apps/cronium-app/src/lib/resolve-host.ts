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
 * There are two ways in, because there are two kinds of connection:
 * - `resolveHost`, for the SSRF guard, whose hosts have to be public. It tries no search
 *   domains, because a short name for an internal host is refused anyway, and it fails
 *   on half an answer, because it can't check an address it wasn't told about.
 * - `resolveHostWithSearch`, `lookupWithSearch` and the sockets below, for SSH servers,
 *   databases and mail servers, where an internal name is normal and any address is
 *   allowed. Here a short name has to find what it found before, and half an answer is
 *   still somewhere to connect to.
 *
 * What getaddrinfo also did:
 * - It reads /etc/hosts first, so both do.
 * - Docker service names need nothing here: the name server in a compose network's
 *   resolv.conf is the one that answers them.
 * - It tries search domains, so `resolveHostWithSearch` does. Outside the published
 *   image it can also ask NSS modules such as mDNS. Nothing here does: falling back to
 *   it would let a name server answer "no such name" to c-ares and hang for getaddrinfo.
 *
 * Server-only: it imports fs and dns.
 */
import type { LookupAddress } from "dns";
import { Resolver } from "dns/promises";
import { readFileSync } from "fs";
import net from "net";

const HOSTS_FILE = "/etc/hosts";
const RESOLV_CONF = "/etc/resolv.conf";

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

/**
 * The search list and `ndots`, read on every lookup as the hosts file is. glibc and musl
 * both let the last of `search` and `domain` win and cap `ndots` at 15. With no file, no
 * search list, which is what musl does; glibc would also try the domain of the machine's
 * own name.
 */
function readResolvConf(): { search: string[]; ndots: number } {
  let text = "";
  try {
    text = readFileSync(RESOLV_CONF, "utf8");
  } catch {
    // As if the file were empty.
  }

  let search: string[] = [];
  let ndots = 1;
  for (const line of text.split("\n")) {
    const [keyword, ...values] = line
      .replace(/[#;].*/, "")
      .trim()
      .split(/\s+/);
    if (keyword === "search" || keyword === "domain") search = values;
    if (keyword === "options") {
      for (const option of values) {
        const match = /^ndots:(\d+)$/.exec(option);
        if (match) ndots = Math.min(Number(match[1]), 15);
      }
    }
  }
  return { search, ndots };
}

/**
 * The names to ask for, in glibc's order: the name as typed goes first if it has enough
 * dots, and otherwise after the search domains. A trailing dot means that name and no
 * other. musl is the same, except that it stops at a name with enough dots, so on the
 * published image a name that used to fail can now find a host through a search domain.
 */
function namesToTry(hostname: string): string[] {
  if (hostname.endsWith(".")) return [hostname];
  const { search, ndots } = readResolvConf();
  const dots = hostname.split(".").length - 1;
  const qualified = search.map((domain) => `${hostname}.${domain}`);
  return dots >= ndots ? [hostname, ...qualified] : [...qualified, hostname];
}

/**
 * A name c-ares won't ask about can't exist. It may only be what a search made of it: too
 * long, or `db..` from `search .`, which is how a resolver says there's no search list.
 */
function noRecordsOrBadName(error: NodeJS.ErrnoException): string[] {
  return error.code === "EBADNAME" ? [] : noRecords(error);
}

/**
 * Every address a host resolves to, IPv4 first, or none if it has none, for a connection
 * that's allowed to reach anything: see the top of this file.
 *
 * It tries search domains in turn. A name that doesn't exist or has no addresses moves
 * on to the next. A name server that doesn't answer, or fails, stops the search, as on
 * the published image: going on could find a different host only because of a passing
 * failure. That also limits a host whose name server hangs to one name's worth of
 * waiting, 6 to 8 seconds.
 *
 * Half an answer is enough, where `resolveHost` refuses it: nothing checks these
 * addresses, and it's what a resolver with a broken AAAA needs. It waits for the other
 * family to finish, so a family that hangs costs that wait.
 */
export async function resolveHostWithSearch(
  hostname: string,
): Promise<LookupAddress[]> {
  const fromHostsFile = addressesInHostsFile(hostname);
  if (fromHostsFile.length > 0) return fromHostsFile;

  for (const name of namesToTry(hostname)) {
    // One for each name, because c-ares cuts a server's timeout to about what its recent
    // answers took. After a search domain's instant "no such name", a public name would
    // get a quarter of a second to recurse instead of 2.5 seconds.
    const resolver = new Resolver({ timeout: FIRST_TRY_MS, tries: TRIES });
    const [v4, v6] = await Promise.allSettled([
      resolver.resolve4(name).catch(noRecordsOrBadName),
      resolver.resolve6(name).catch(noRecordsOrBadName),
    ]);
    const addresses: LookupAddress[] = [
      ...(v4.status === "fulfilled" ? v4.value : []).map((address) => ({
        address,
        family: 4,
      })),
      ...(v6.status === "fulfilled" ? v6.value : []).map((address) => ({
        address,
        family: 6,
      })),
    ];
    if (addresses.length > 0) return addresses;
    if (v4.status === "rejected" || v6.status === "rejected") {
      throw lookupError("EAI_AGAIN", hostname);
    }
  }
  return [];
}

/**
 * The same error as `dns.lookup`'s, so the clients above this and the code that reads
 * their errors (the SSH messages, the tool error categories) don't see a difference.
 */
function lookupError(code: "ENOTFOUND" | "EAI_AGAIN", hostname: string) {
  return Object.assign(new Error(`getaddrinfo ${code} ${hostname}`), {
    code,
    syscall: "getaddrinfo",
    hostname,
  });
}

/**
 * `dns.lookup`'s contract over `resolveHostWithSearch`, for anything that takes a
 * `lookup`. It has to honour `all`, because `net.connect` asks for every address.
 */
export const lookupWithSearch: net.LookupFunction = (
  hostname,
  options,
  callback,
) => {
  const fail = (error: NodeJS.ErrnoException) => callback(error, "", 0);
  const family =
    options?.family === "IPv4"
      ? 4
      : options?.family === "IPv6"
        ? 6
        : (options?.family ?? 0);

  resolveHostWithSearch(hostname)
    .then((addresses) => {
      const candidates = family
        ? addresses.filter((a) => a.family === family)
        : addresses;
      const chosen = candidates[0];
      if (!chosen) {
        fail(lookupError("ENOTFOUND", hostname));
      } else if (options?.all) {
        callback(null, candidates);
      } else {
        callback(null, chosen.address, chosen.family);
      }
    })
    .catch(fail);
};

/** A socket on its way to a host, for a client that takes one that's already connecting. */
export function connectWithSearch(host: string, port: number): net.Socket {
  return net.connect({ host, port, lookup: lookupWithSearch });
}

/**
 * A socket for a client that calls `connect(port, host)` on it itself and takes the host
 * for its TLS server name, as `pg` does, so it can't simply be handed an address.
 * Anything else, such as the path of a Unix socket, goes through as it was.
 */
export function socketWithSearch(): net.Socket {
  const socket = new net.Socket();
  const connect = socket.connect.bind(socket) as (
    ...args: unknown[]
  ) => net.Socket;
  socket.connect = (...args: unknown[]) =>
    typeof args[0] === "number" && typeof args[1] === "string"
      ? connect({ port: args[0], host: args[1], lookup: lookupWithSearch })
      : connect(...args);
  return socket;
}
