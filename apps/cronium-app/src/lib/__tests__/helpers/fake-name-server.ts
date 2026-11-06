/**
 * A real name server on a UDP socket, so a test exercises c-ares with real replies and
 * real timeouts instead of a promise a mock chooses to settle.
 *
 * Point the code under test at it by mocking `Resolver` from `dns/promises` with the
 * real one plus `setServers`, as `resolve-host.test.ts` does.
 */
import dgram from "dgram";
import type { AddressInfo } from "net";

/** Never reply, as a name server that's down or dropping these queries does. */
export const NEVER = "never";

type FamilyAnswer = string[] | typeof NEVER | "SERVFAIL" | "REFUSED";

export type ZoneEntry =
  | typeof NEVER
  | "SERVFAIL"
  | "REFUSED"
  | {
      A?: FamilyAnswer;
      AAAA?: FamilyAnswer;
      CNAME?: string;
      /** How long to take over each reply. */
      delayMs?: number;
    };

const TYPE_A = 1;
const TYPE_CNAME = 5;
const TYPE_AAAA = 28;
const RCODE: Record<string, number> = { SERVFAIL: 2, NXDOMAIN: 3, REFUSED: 5 };

export interface FakeNameServer {
  port: number;
  /** Every query it has received. */
  queries: Array<{ name: string; type: "A" | "AAAA" | number }>;
  zone: Map<string, ZoneEntry>;
  close: () => Promise<void>;
}

function encodeName(name: string): Buffer {
  return Buffer.concat([
    ...name
      .split(".")
      .filter(Boolean)
      .map((label) =>
        Buffer.concat([Buffer.from([label.length]), Buffer.from(label)]),
      ),
    Buffer.from([0]),
  ]);
}

function encodeIpv6(address: string): Buffer {
  const [head = "", tail = ""] = address.split("::");
  const left = head ? head.split(":") : [];
  const right = tail ? tail.split(":") : [];
  const zeros = Array<string>(8 - left.length - right.length).fill("0");
  const bytes = Buffer.alloc(16);
  [...left, ...zeros, ...right].forEach((group, index) =>
    bytes.writeUInt16BE(parseInt(group, 16), index * 2),
  );
  return bytes;
}

function record(owner: string, type: number, rdata: Buffer): Buffer {
  const fixed = Buffer.alloc(10);
  fixed.writeUInt16BE(type, 0);
  fixed.writeUInt16BE(1, 2); // class IN
  fixed.writeUInt32BE(0, 4); // TTL
  fixed.writeUInt16BE(rdata.length, 8);
  return Buffer.concat([encodeName(owner), fixed, rdata]);
}

function reply(
  query: Buffer,
  questionEnd: number,
  rcode: number,
  records: Buffer[],
): Buffer {
  const header = Buffer.alloc(12);
  query.copy(header, 0, 0, 2); // the query's id
  header[2] = 0x80 | (query[2]! & 1); // a response, repeating "recursion desired"
  header[3] = 0x80 | rcode; // "recursion available"
  header.writeUInt16BE(1, 4);
  header.writeUInt16BE(records.length, 6);
  return Buffer.concat([header, query.subarray(12, questionEnd), ...records]);
}

export async function startNameServer(
  zone: Record<string, ZoneEntry> = {},
): Promise<FakeNameServer> {
  const socket = dgram.createSocket("udp4");
  const server: FakeNameServer = {
    port: 0,
    queries: [],
    zone: new Map(Object.entries(zone)),
    close: () => new Promise((resolve) => socket.close(() => resolve())),
  };

  socket.on("message", (query, peer) => {
    const labels: string[] = [];
    let offset = 12;
    for (let length = query[offset]!; length > 0; length = query[offset]!) {
      labels.push(query.toString("latin1", offset + 1, offset + 1 + length));
      offset += length + 1;
    }
    offset += 1;
    const name = labels.join(".").toLowerCase();
    const qtype = query.readUInt16BE(offset);
    const questionEnd = offset + 4;
    const family = qtype === TYPE_A ? "A" : qtype === TYPE_AAAA ? "AAAA" : null;
    server.queries.push({ name, type: family ?? qtype });

    const send = (rcode: number, records: Buffer[] = []) =>
      socket.send(
        reply(query, questionEnd, rcode, records),
        peer.port,
        peer.address,
      );

    const entry = server.zone.get(name);
    if (entry === undefined) return send(RCODE.NXDOMAIN!);
    if (entry === NEVER) return;
    if (typeof entry === "string") return send(RCODE[entry]!);

    const answer = family ? entry[family] : undefined;
    if (answer === NEVER) return;
    const respond = (rcode: number, records: Buffer[] = []) => {
      if (entry.delayMs) setTimeout(() => send(rcode, records), entry.delayMs);
      else send(rcode, records);
    };
    if (typeof answer === "string") return respond(RCODE[answer]!);

    // Owned by the alias's target when there is one, as a real chain is.
    const records: Buffer[] = [];
    let owner = name;
    if (entry.CNAME) {
      records.push(record(name, TYPE_CNAME, encodeName(entry.CNAME)));
      owner = entry.CNAME;
    }
    for (const address of answer ?? []) {
      records.push(
        qtype === TYPE_A
          ? record(owner, TYPE_A, Buffer.from(address.split(".").map(Number)))
          : record(owner, TYPE_AAAA, encodeIpv6(address)),
      );
    }
    respond(0, records);
  });

  await new Promise<void>((resolve) => socket.bind(0, "127.0.0.1", resolve));
  server.port = (socket.address() as AddressInfo).port;
  return server;
}
