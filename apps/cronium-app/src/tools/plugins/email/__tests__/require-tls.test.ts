/**
 * @jest-environment node
 *
 * An Email credential's Enable TLS box is ticked by default, and says the login and the
 * message travel encrypted. Without STARTTLS they can't, so the send and the connection
 * test must stop before AUTH. These talk to a small mail server in this process that
 * remembers every line it was sent, so a password sent in the clear shows.
 */
jest.mock("@/server/db", () => ({ db: {} }));
jest.mock("@/env.mjs", () => ({ env: {} }));

import net from "node:net";
import type { ExecutionContext } from "@/tools/types/tool-plugin";
import { ErrorCategorizer } from "@/lib/tools/error-categorization";
import {
  createRetryExecutor,
  defaultRetryConfigs,
} from "@/lib/tools/retry-strategies";
import { emailActions } from "../actions";
import { testConnection } from "../connection-test";

const PASSWORD = "right-password";
const BODY = "the quarterly numbers";

/**
 * Speaks just enough SMTP for nodemailer and offers AUTH PLAIN. STARTTLS is:
 * - "unoffered": not listed, as on a relay without TLS or behind someone who strips it,
 *   and answered as an unknown command.
 * - "refused": listed, then refused.
 * - "broken": listed and accepted, then answered with bytes that aren't TLS.
 */
async function mailServer({
  startTls,
}: {
  startTls: "unoffered" | "refused" | "broken";
}) {
  const transcript: string[] = [];
  const commands: string[] = [];
  const server = net.createServer((socket) => {
    let buffer = "";
    let inData = false;
    let upgrading = false;
    socket.write("220 test ESMTP\r\n");
    socket.on("data", (chunk: Buffer) => {
      if (upgrading) {
        socket.end("this is not TLS\r\n");
        return;
      }
      buffer += chunk.toString("utf8");
      for (let end = buffer.indexOf("\r\n"); end !== -1;) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\r\n");
        transcript.push(line);
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 2.0.0 queued\r\n");
          }
          continue;
        }
        const verb = (line.split(" ")[0] ?? "").toUpperCase();
        commands.push(verb);
        if (verb === "EHLO") {
          socket.write(
            "250-test\r\n" +
              (startTls === "unoffered" ? "" : "250-STARTTLS\r\n") +
              "250 AUTH PLAIN\r\n",
          );
        } else if (verb === "STARTTLS") {
          if (startTls === "broken") {
            upgrading = true;
            socket.write("220 2.0.0 Ready to start TLS\r\n");
          } else {
            socket.write(
              startTls === "refused"
                ? "454 4.7.0 TLS not available\r\n"
                : "502 5.5.1 Unrecognized command\r\n",
            );
          }
        } else if (verb === "AUTH") {
          const encoded = line.split(" ")[2] ?? "";
          const password = Buffer.from(encoded, "base64")
            .toString("utf8")
            .split("\0")[2];
          socket.write(
            password === PASSWORD
              ? "235 2.7.0 Authentication successful\r\n"
              : "535 5.7.8 Authentication failed\r\n",
          );
        } else if (verb === "MAIL" || verb === "RCPT") {
          socket.write("250 OK\r\n");
        } else if (verb === "DATA") {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (verb === "QUIT") {
          socket.end("221 bye\r\n");
        } else {
          socket.write("502 5.5.1 Unrecognized command\r\n");
        }
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    /** Every line the server read, AUTH's base64 and the message included. */
    heard: () => transcript.join("\n"),
    /** The commands alone, without the message, or QUIT, which can come after a send resolves. */
    verbs: () => commands.filter((verb) => verb !== "QUIT"),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

// The password as AUTH PLAIN puts it on the wire, which is all base64 hides.
const plainLogin = Buffer.from(`\0ops\0${PASSWORD}`).toString("base64");

// What a credential's Test button and a run say when the box stopped the session.
const REFUSED =
  "127.0.0.1 didn't switch to TLS when asked (STARTTLS), so Cronium didn't sign in or send anything. " +
  "To use this server without encryption, untick Enable TLS on this credential. " +
  "The server answered: 502 5.5.1 Unrecognized command";

// No enableTLS unless a test sets it, as on a credential saved without the box.
const credentialsFor = (port: number, overrides: Record<string, unknown>) => ({
  smtpHost: "127.0.0.1",
  smtpPort: port,
  smtpUser: "ops",
  smtpPassword: PASSWORD,
  fromEmail: "cronium@example.test",
  fromName: "Cronium",
  enableSSL: false,
  ...overrides,
});

const send = emailActions.find((a) => a.id === "send-email")!;
const context = {
  logger: {
    info: jest.fn(),
    warn: jest.fn(),
    error: jest.fn(),
    debug: jest.fn(),
  },
} as unknown as ExecutionContext;
const params = { to: "someone@example.test", subject: "Numbers", body: BODY };

let server: Awaited<ReturnType<typeof mailServer>> | undefined;

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(async () => {
  jest.restoreAllMocks();
  await server?.close();
  server = undefined;
});

describe("Enable TLS, on a server that doesn't offer STARTTLS", () => {
  it("sends nothing, and never gives the server the password", async () => {
    server = await mailServer({ startTls: "unoffered" });

    const sent = await send
      .execute(
        credentialsFor(server.port, { enableTLS: true }),
        params,
        context,
      )
      .catch((e: Error) => e);

    expect(server.heard()).not.toContain(plainLogin);
    expect(server.heard()).not.toContain(BODY);
    expect(server.verbs()).toEqual(["EHLO", "STARTTLS"]);
    expect(sent).toBeInstanceOf(Error);
    expect((sent as Error).message).toBe(REFUSED);
  });

  // Saved credentials hold whatever the form had, and the schema fills in a missing box
  // as ticked, so one saved without it is held to the same.
  it("treats a credential without the box as ticked", async () => {
    server = await mailServer({ startTls: "unoffered" });

    const sent = await send
      .execute(credentialsFor(server.port, {}), params, context)
      .catch((e: Error) => e);

    expect(server.verbs()).toEqual(["EHLO", "STARTTLS"]);
    expect((sent as Error).message).toBe(REFUSED);
  });

  it("fails the connection test before signing in", async () => {
    server = await mailServer({ startTls: "unoffered" });

    const tested = await testConnection(
      credentialsFor(server.port, { enableTLS: true }),
    ).catch((e: Error) => e);

    expect(server.heard()).not.toContain(plainLogin);
    expect(server.verbs()).toEqual(["EHLO", "STARTTLS"]);
    expect(tested).toBeInstanceOf(Error);
    expect((tested as Error).message).toBe(REFUSED);
  });

  it("fails the connection test of a credential without the box", async () => {
    server = await mailServer({ startTls: "unoffered" });

    const tested = await testConnection(credentialsFor(server.port, {})).catch(
      (e: Error) => e,
    );

    expect(server.verbs()).toEqual(["EHLO", "STARTTLS"]);
    expect((tested as Error).message).toBe(REFUSED);
  });

  // The event form's test run reaches the action with `isTest`. However the action
  // treats that, sending for real or only signing in, it has to stop the same way.
  it("stops the event form's test run the same way", async () => {
    server = await mailServer({ startTls: "unoffered" });

    const tested = await send
      .execute(credentialsFor(server.port, { enableTLS: true }), params, {
        ...context,
        isTest: true,
      })
      .catch((e: Error) => e);

    expect(server.heard()).not.toContain(plainLogin);
    expect(server.verbs()).toEqual(["EHLO", "STARTTLS"]);
    expect((tested as Error).message).toBe(REFUSED);
  });

  it("stops the event form's Check Login of a credential without the box", async () => {
    server = await mailServer({ startTls: "unoffered" });

    const checked = await send
      .execute(credentialsFor(server.port, {}), params, {
        ...context,
        isTest: true,
      })
      .catch((e: Error) => e);

    expect(server.verbs()).toEqual(["EHLO", "STARTTLS"]);
    expect((checked as Error).message).toBe(REFUSED);
  });

  // The scheduler runs an action inside a retry executor that puts the message in its
  // own, then picks a run's first line by the text. The server's 502 used to make that
  // "Service unavailable".
  it("reads as the credential's setting in a run, not as an outage", async () => {
    server = await mailServer({ startTls: "unoffered" });
    const credentials = credentialsFor(server.port, { enableTLS: true });
    const retry = createRetryExecutor("exponential", {
      ...defaultRetryConfigs.standard,
      maxAttempts: 1,
    });

    const failed = await retry
      .execute(() => send.execute(credentials, params, context))
      .catch((e: Error) => e);

    expect((failed as Error).message).toContain(REFUSED);
    expect(ErrorCategorizer.categorize(failed as Error, "email")).toMatchObject(
      {
        category: "configuration",
        retryable: false,
        userMessage: "The mail server didn't switch to TLS",
      },
    );
  });
});

describe("Enable TLS, when STARTTLS goes wrong after the server offers it", () => {
  // Unticking the box wouldn't help with a handshake that fails, so the error stays the
  // TLS library's. It comes from Node's own realm, which Jest's `Error` isn't.
  it("leaves a failed handshake's error alone, and sends nothing", async () => {
    server = await mailServer({ startTls: "broken" });

    const sent = await send
      .execute(
        credentialsFor(server.port, { enableTLS: true }),
        params,
        context,
      )
      .catch((e: Error) => e);

    expect(server.verbs()).toEqual(["EHLO", "STARTTLS"]);
    expect(sent).toHaveProperty("message");
    expect((sent as Error).message).not.toContain("Enable TLS");
  });
});

describe("Enable TLS unticked", () => {
  it("still sends to a server without STARTTLS, as before", async () => {
    server = await mailServer({ startTls: "unoffered" });

    await expect(
      send.execute(
        credentialsFor(server.port, { enableTLS: false }),
        params,
        context,
      ),
    ).resolves.toMatchObject({ status: "sent" });
    expect(server.verbs()).toEqual(["EHLO", "AUTH", "MAIL", "RCPT", "DATA"]);
  });

  // Unticked isn't "never encrypt": a server that offers STARTTLS still gets it, and one
  // that offers it and then refuses gets no password, as before. The box isn't why that
  // failed, so the message doesn't point at it.
  it("still upgrades when the server offers STARTTLS", async () => {
    server = await mailServer({ startTls: "refused" });

    const sent = await send
      .execute(
        credentialsFor(server.port, { enableTLS: false }),
        params,
        context,
      )
      .catch((e: Error) => e);

    expect(server.verbs()).toEqual(["EHLO", "STARTTLS"]);
    expect((sent as Error).message).toBe(
      "Error upgrading connection with STARTTLS: 454 4.7.0 TLS not available",
    );
  });
});
