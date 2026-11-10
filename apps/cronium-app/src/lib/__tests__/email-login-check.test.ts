/**
 * @jest-environment node
 *
 * The event form's Check Login runs `checkSmtpLogin`. It has to reach the mail server the
 * way a send would, with the same settings, and stop before anything is sent. A check that
 * passed on settings the send refuses, or that went on to MAIL FROM, would be untrue.
 * These talk to a small mail server in this process, which remembers what it was told.
 */
jest.mock("@/server/db", () => ({ db: {} }));
jest.mock("@/env.mjs", () => ({ env: {} }));

import net from "node:net";
import nodemailer from "nodemailer";
import {
  checkSmtpLogin,
  sendEmailDetailed,
  StartTlsRefusedError,
} from "../email";

const PASSWORD = "right-password";

/** Speaks just enough SMTP for nodemailer, offering AUTH PLAIN or nothing. */
async function mailServer({ offersAuth }: { offersAuth: boolean }) {
  const heard: string[] = [];
  const closed: Promise<void>[] = [];
  const server = net.createServer((socket) => {
    closed.push(new Promise((resolve) => socket.on("close", () => resolve())));
    let buffer = "";
    let inData = false;
    socket.write("220 test ESMTP\r\n");
    socket.on("data", (chunk: Buffer) => {
      buffer += chunk.toString("utf8");
      for (let end = buffer.indexOf("\r\n"); end !== -1;) {
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        end = buffer.indexOf("\r\n");
        if (inData) {
          if (line === ".") {
            inData = false;
            socket.write("250 2.0.0 queued\r\n");
          }
          continue;
        }
        const verb = (line.split(" ")[0] ?? "").toUpperCase();
        heard.push(verb);
        if (verb === "EHLO") {
          socket.write(
            offersAuth ? "250-test\r\n250 AUTH PLAIN\r\n" : "250 test\r\n",
          );
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
          socket.write("502 not here\r\n");
        }
      }
    });
    socket.on("error", () => undefined);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as net.AddressInfo;
  return {
    port,
    heard,
    // nodemailer answers once it has sent QUIT, before the server has read it.
    hung: () => Promise.all(closed),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

const smtpFor = (port: number, password = PASSWORD) => ({
  host: "127.0.0.1",
  port,
  user: "ops",
  password,
  fromEmail: "cronium@example.test",
  fromName: "Cronium",
});

const message = {
  to: "someone@example.test",
  subject: "s",
  text: "b",
  html: "<p>b</p>",
};

let server: Awaited<ReturnType<typeof mailServer>> | undefined;

afterEach(async () => {
  jest.restoreAllMocks();
  await server?.close();
  server = undefined;
});

beforeEach(() => {
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("checkSmtpLogin", () => {
  it("signs in and leaves, without starting a message", async () => {
    server = await mailServer({ offersAuth: true });

    await expect(checkSmtpLogin(smtpFor(server.port))).resolves.toEqual({
      signedIn: true,
    });

    await server.hung();
    expect(server.heard).toEqual(["EHLO", "AUTH", "QUIT"]);
  });

  it("fails on a wrong password, as the send does", async () => {
    server = await mailServer({ offersAuth: true });
    const smtp = smtpFor(server.port, "wrong-password");

    const checked = await checkSmtpLogin(smtp).catch((e: Error) => e);
    const sent = await sendEmailDetailed(message, smtp).catch((e: Error) => e);

    expect(checked).toBeInstanceOf(Error);
    expect((checked as Error).message).toMatch(/535/);
    expect((checked as Error).message).toBe((sent as Error).message);
    expect(server.heard).not.toContain("MAIL");
  });

  // nodemailer signs in only when the server offers AUTH, for a send as for this, so
  // the toast can't say a password was accepted when nobody asked for one.
  it("says so when the server never asked for a login", async () => {
    server = await mailServer({ offersAuth: false });

    await expect(checkSmtpLogin(smtpFor(server.port))).resolves.toEqual({
      signedIn: false,
    });

    await server.hung();
    expect(server.heard).toEqual(["EHLO", "QUIT"]);
  });

  // Enable TLS asks for STARTTLS whether or not the server lists it. A check that signed
  // in without TLS where the send won't would give the password to anyone in between.
  it("won't sign in without TLS when TLS is required, as the send won't", async () => {
    server = await mailServer({ offersAuth: true });
    const smtp = { ...smtpFor(server.port), requireTls: true };

    const checked = await checkSmtpLogin(smtp).catch((e: Error) => e);
    expect(server.heard).toEqual(["EHLO", "STARTTLS"]);
    const sent = await sendEmailDetailed(message, smtp).catch((e: Error) => e);

    expect(checked).toBeInstanceOf(StartTlsRefusedError);
    expect((checked as Error).message).toBe(
      "127.0.0.1 didn't switch to TLS when asked (STARTTLS), so Cronium didn't sign in or send anything. " +
        "To use this server without encryption, untick Enable TLS on this credential. " +
        "The server answered: 502 not here",
    );
    expect((checked as Error).message).toBe((sent as Error).message);
    expect(server.heard).not.toContain("AUTH");
  });

  it("refuses what the send refuses before connecting", async () => {
    await expect(
      checkSmtpLogin({ ...smtpFor(25), password: "" }),
    ).rejects.toThrow("SMTP_CONFIG_MISSING");
  });

  // email/connection-test.ts accepts any certificate, and the send doesn't. A check built
  // like that one could pass for a server the send then refuses.
  it("connects with exactly the send's settings", async () => {
    server = await mailServer({ offersAuth: true });
    const createTransport = jest.spyOn(nodemailer, "createTransport");
    const smtp = { ...smtpFor(server.port), secure: false };

    await checkSmtpLogin(smtp);
    await sendEmailDetailed(message, smtp);

    expect(createTransport).toHaveBeenCalledTimes(2);
    const [checked, sent] = createTransport.mock.calls.map(([options]) =>
      settings(options),
    );
    expect(checked).toEqual(sent);
    expect(checked).not.toHaveProperty("tls");
  });
});

/** A transport's options, with what only watches it set aside. */
function settings(options: unknown): Record<string, unknown> {
  const { logger: _logger, ...rest } = options as Record<string, unknown>;
  return Object.fromEntries(
    Object.entries(rest).map(([key, value]) => [
      key,
      typeof value === "function" ? "a function" : value,
    ]),
  );
}
