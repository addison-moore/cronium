/**
 * A sensitive system setting that can't be decrypted, usually after a change of
 * ENCRYPTION_KEY. Each read used to return the stored ciphertext as the value, so it
 * went out as an SMTP password or an API key, with a log line as the only sign.
 *
 * These run the real reads, routers, nodemailer and OpenAI client against real
 * Postgres, with a real SMTP server and HTTP endpoint on loopback. So "nothing was
 * sent" means nothing reached a socket, and the controls show those sockets do see a
 * send that's allowed.
 */
// The callers below are handed their session directly. The real NextAuth stack
// needs a request scope this suite does not have, and nothing here reaches it.
jest.mock("next-auth", () => ({
  getServerSession: jest.fn().mockResolvedValue(null),
}));
jest.mock("@/lib/auth", () => ({ authOptions: {} }));

import { createCipheriv, randomBytes } from "node:crypto";
import http from "node:http";
import net from "node:net";
import type { AddressInfo } from "node:net";
import { format } from "node:util";
import type { Session } from "next-auth";
import { getAiConfig, isAiConfigured, listAvailableModels } from "@/lib/ai";
import { cacheService } from "@/lib/cache/cache-service";
import {
  getSmtpSettings,
  sendEmail,
  sendEmailDetailed,
  sendInvitationEmail,
  sendPasswordResetEmail,
} from "@/lib/email";
import {
  __resetSecretVaultForTests,
  isSecretEnvelope,
} from "@/lib/security/secret-vault";
import { UnreadableSettingError } from "@/lib/security/unreadable-setting";
import { adminRouter } from "@/server/api/routers/admin";
import { aiRouter } from "@/server/api/routers/ai";
import { userAuthRouter } from "@/server/api/routers/userAuth";
import { createCallerFactory, createTRPCRouter } from "@/server/api/trpc";
import { db, pool } from "@/server/db";
import { storage } from "@/server/storage";
import { UserRole, UserStatus } from "@/shared/schema";
import { closePool, resetDatabase } from "./helpers/db-reset";
import { seedUser } from "./helpers/seed";

// jest-circus only reads a global testTimeout, so the one on this project in
// jest.config.js has no effect and the default here would be 5 seconds.
jest.setTimeout(60_000);

const OLD_KEY = "aa".repeat(32);
const NEW_KEY = "bb".repeat(32);
const ORIGINAL_KEY = process.env.ENCRYPTION_KEY;
const PASSWORD = "real-smtp-password";
const API_KEY = "real-api-key";
const MESSAGE = {
  to: "someone@example.test",
  subject: "Subject",
  text: "Body",
  html: "<p>Body</p>",
};

function useKeys(active: string, retired?: string[]) {
  process.env.ENCRYPTION_KEY = active;
  if (retired) process.env.ENCRYPTION_KEYS_RETIRED = JSON.stringify(retired);
  else delete process.env.ENCRYPTION_KEYS_RETIRED;
  __resetSecretVaultForTests();
}

/** How the bootstrap seed stored SMTP_PASSWORD before the vault. */
function staticAadCiphertext(keyHex: string, plaintext: string): string {
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-gcm", Buffer.from(keyHex, "hex"), iv);
  cipher.setAAD(Buffer.from("cronium-server-encryption"));
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, ciphertext, cipher.getAuthTag()]).toString(
    "base64",
  );
}

const seedRawSetting = (key: string, value: string) =>
  pool.query(
    `INSERT INTO system_settings (key, value) VALUES ($1, $2)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [key, value],
  );

async function storedValue(key: string): Promise<string> {
  const { rows } = await pool.query<{ value: string }>(
    `SELECT value FROM system_settings WHERE key = $1`,
    [key],
  );
  return rows[0]!.value;
}

/**
 * Every way a sensitive setting ends up unreadable. Each leaves the row in place,
 * makes it unreadable and returns what's stored.
 */
const UNREADABLE: Array<[string, () => Promise<string>]> = [
  [
    "an envelope under a key that's gone",
    async () => {
      await storage.upsertSetting("smtpPassword", PASSWORD);
      useKeys(NEW_KEY);
      return storedValue("smtpPassword");
    },
  ],
  [
    "static-AAD ciphertext under a key that's gone",
    async () => {
      const stored = staticAadCiphertext(OLD_KEY, PASSWORD);
      await seedRawSetting("smtpPassword", stored);
      useKeys(NEW_KEY);
      return stored;
    },
  ],
  [
    "static-AAD ciphertext that a retired key would open, which reads don't try",
    async () => {
      const stored = staticAadCiphertext(OLD_KEY, PASSWORD);
      await seedRawSetting("smtpPassword", stored);
      useKeys(NEW_KEY, [OLD_KEY]);
      return stored;
    },
  ],
  [
    "another setting's envelope copied into this row",
    async () => {
      await storage.upsertSetting("openaiApiKey", API_KEY);
      const stored = await storedValue("openaiApiKey");
      await seedRawSetting("smtpPassword", stored);
      return stored;
    },
  ],
  [
    "a damaged envelope",
    async () => {
      await storage.upsertSetting("smtpPassword", PASSWORD);
      const stored = `${await storedValue("smtpPassword")}x`;
      await seedRawSetting("smtpPassword", stored);
      return stored;
    },
  ],
  [
    "a keyring that can't be loaded",
    async () => {
      await storage.upsertSetting("smtpPassword", PASSWORD);
      process.env.ENCRYPTION_KEYS_RETIRED = "not-json";
      __resetSecretVaultForTests();
      return storedValue("smtpPassword");
    },
  ],
  [
    // Nothing tells this from ciphertext under a key that's gone, so it can't be used.
    "a long plaintext from before settings were encrypted, made of base64 characters",
    async () => {
      const stored = "abcdef0123456789".repeat(4);
      await seedRawSetting("smtpPassword", stored);
      return stored;
    },
  ],
];

/**
 * A real SMTP server, as much of one as nodemailer needs. It accepts any login and
 * records what it was given, the way a third party would see it.
 */
function startSmtpServer() {
  const recorded = {
    connections: 0,
    logins: [] as Array<{ user: string; password: string }>,
    delivered: 0,
  };
  const sockets = new Set<net.Socket>();
  const server = net.createServer((socket) => {
    recorded.connections++;
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
    socket.on("error", () => undefined);
    socket.setEncoding("utf8");
    socket.write("220 test ESMTP\r\n");
    let buffer = "";
    let inData = false;
    socket.on("data", (chunk: string) => {
      buffer += chunk;
      for (;;) {
        const end = buffer.indexOf("\r\n");
        if (end < 0) return;
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 2);
        if (inData) {
          if (line === ".") {
            inData = false;
            recorded.delivered++;
            socket.write("250 queued\r\n");
          }
        } else if (/^EHLO/i.test(line)) {
          socket.write("250-test\r\n250 AUTH PLAIN\r\n");
        } else if (/^AUTH PLAIN /i.test(line)) {
          const [, user, password] = Buffer.from(line.slice(11), "base64")
            .toString("utf8")
            .split("\0");
          recorded.logins.push({ user: user!, password: password! });
          socket.write("235 ok\r\n");
        } else if (/^DATA/i.test(line)) {
          inData = true;
          socket.write("354 go ahead\r\n");
        } else if (/^QUIT/i.test(line)) {
          socket.end("221 bye\r\n");
        } else {
          socket.write("250 ok\r\n");
        }
      }
    });
  });
  return new Promise<{
    port: number;
    recorded: typeof recorded;
    reset: () => void;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        recorded,
        reset: () => {
          recorded.connections = 0;
          recorded.logins.length = 0;
          recorded.delivered = 0;
        },
        close: () =>
          new Promise((done) => {
            for (const socket of sockets) socket.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}

/** A real OpenAI-compatible endpoint. It records the key each request carries. */
function startAiEndpoint() {
  const requests: Array<{ url: string; authorization: string | undefined }> =
    [];
  const server = http.createServer((req, res) => {
    requests.push({
      url: req.url ?? "",
      authorization: req.headers.authorization,
    });
    req.resume();
    req.on("end", () => {
      res.setHeader("content-type", "application/json");
      res.end(
        JSON.stringify(
          req.url?.endsWith("/models")
            ? { object: "list", data: [{ id: "llama3", object: "model" }] }
            : {
                id: "completion",
                object: "chat.completion",
                created: 1,
                model: "llama3",
                choices: [
                  {
                    index: 0,
                    finish_reason: "stop",
                    message: { role: "assistant", content: "echo hello" },
                  },
                ],
              },
        ),
      );
    });
  });
  return new Promise<{
    url: string;
    requests: typeof requests;
    close: () => Promise<void>;
  }>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      resolve({
        url: `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`,
        requests,
        close: () =>
          new Promise((done) => {
            server.closeAllConnections();
            server.close(() => done());
          }),
      });
    });
  });
}

async function waitUntil(check: () => boolean): Promise<void> {
  const deadline = Date.now() + 15_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error("Timed out waiting");
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

const createCaller = createCallerFactory(
  // Mounted under the names root.ts uses, because the route-capability inventory
  // is keyed by "admin.<procedure>".
  createTRPCRouter({
    admin: adminRouter,
    ai: aiRouter,
    userAuth: userAuthRouter,
  }),
);

function callerFor(userId: string) {
  return createCaller({
    session: {
      user: { id: userId, sessionVersion: 1 },
      expires: new Date(Date.now() + 60_000).toISOString(),
    } as unknown as Session,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });
}

const anonymousCaller = () =>
  createCaller({
    session: null,
    db,
    headers: new Headers(),
    tokenScopes: null,
    requestSource: null,
  });

const seedAdmin = () =>
  seedUser({
    role: UserRole.ADMIN,
    status: UserStatus.ACTIVE,
    sessionVersion: 1,
  });

let smtp: Awaited<ReturnType<typeof startSmtpServer>>;
let aiEndpoint: Awaited<ReturnType<typeof startAiEndpoint>>;
let logged: string[];

async function saveSmtpSettings(password = PASSWORD) {
  await storage.upsertSetting("smtpHost", "127.0.0.1");
  await storage.upsertSetting("smtpPort", String(smtp.port));
  await storage.upsertSetting("smtpUser", "mailer");
  await storage.upsertSetting("smtpFromEmail", "noreply@example.test");
  await storage.upsertSetting("smtpPassword", password);
}

async function saveAiSettings() {
  await storage.upsertSetting("aiEnabled", "true");
  await storage.upsertSetting("aiProvider", "custom");
  await storage.upsertSetting("aiModel", "llama3");
  await storage.upsertSetting("customAiBaseUrl", aiEndpoint.url);
  await storage.upsertSetting("customAiApiKey", API_KEY);
}

beforeAll(async () => {
  smtp = await startSmtpServer();
  aiEndpoint = await startAiEndpoint();
});

beforeEach(async () => {
  await resetDatabase();
  useKeys(OLD_KEY);
  smtp.reset();
  aiEndpoint.requests.length = 0;
  logged = [];
  jest.spyOn(console, "error").mockImplementation((...args: unknown[]) => {
    logged.push(format(...args));
  });
  jest.spyOn(console, "log").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  delete process.env.OPENAI_API_KEY;
  delete process.env.ENCRYPTION_KEYS_RETIRED;
});

afterAll(async () => {
  process.env.ENCRYPTION_KEY = ORIGINAL_KEY;
  __resetSecretVaultForTests();
  await smtp.close();
  await aiEndpoint.close();
  await closePool();
  await cacheService.disconnect();
});

describe("storage.getSetting", () => {
  it.each(UNREADABLE)("refuses %s", async (_name, makeUnreadable) => {
    const stored = await makeUnreadable();

    const failure = await storage
      .getSetting("smtpPassword")
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(UnreadableSettingError);
    expect((failure as UnreadableSettingError).key).toBe("smtpPassword");
    expect((failure as UnreadableSettingError).message).not.toContain(stored);
    // The server log names the setting, and never holds what's stored.
    expect(logged.join("\n")).toContain("System setting smtpPassword");
    expect(logged.join("\n")).not.toContain(stored);
  });

  it("reads a value saved under the current key", async () => {
    await storage.upsertSetting("smtpPassword", PASSWORD);

    expect(isSecretEnvelope(await storedValue("smtpPassword"))).toBe(true);
    await expect(storage.getSetting("smtpPassword")).resolves.toMatchObject({
      key: "smtpPassword",
      value: PASSWORD,
    });
  });

  it("reads an envelope under a retired key", async () => {
    await storage.upsertSetting("smtpPassword", PASSWORD);
    useKeys(NEW_KEY, [OLD_KEY]);

    await expect(storage.getSetting("smtpPassword")).resolves.toMatchObject({
      value: PASSWORD,
    });
  });

  it("reads static-AAD ciphertext under the current key", async () => {
    await seedRawSetting(
      "smtpPassword",
      staticAadCiphertext(OLD_KEY, PASSWORD),
    );

    await expect(storage.getSetting("smtpPassword")).resolves.toMatchObject({
      value: PASSWORD,
    });
  });

  it("reads a short plaintext from before settings were encrypted", async () => {
    await seedRawSetting("smtpPassword", "short-plaintext");

    await expect(storage.getSetting("smtpPassword")).resolves.toMatchObject({
      value: "short-plaintext",
    });
  });

  it("has nothing to refuse for a setting that isn't there", async () => {
    await expect(storage.getSetting("smtpPassword")).resolves.toBeUndefined();
  });

  it("doesn't try to decrypt a setting that isn't sensitive", async () => {
    await storage.upsertSetting("smtpPassword", PASSWORD);
    const envelope = await storedValue("smtpPassword");
    await seedRawSetting("systemName", envelope);
    useKeys(NEW_KEY);

    await expect(storage.getSetting("systemName")).resolves.toMatchObject({
      value: envelope,
    });
  });
});

describe("storage.getAllSettings", () => {
  it.each(UNREADABLE)("reports %s", async (_name, makeUnreadable) => {
    await seedRawSetting("smtpHost", "smtp.example.test");
    const stored = await makeUnreadable();

    const { settings, unreadable } = await storage.getAllSettings();

    expect(unreadable).toEqual(["smtpPassword"]);
    expect(settings.map((s) => s.key)).toContain("smtpHost");
    expect(settings.map((s) => s.key)).not.toContain("smtpPassword");
    expect(JSON.stringify({ settings, unreadable })).not.toContain(stored);
  });

  it("gives back the others when one secret can't be read", async () => {
    await seedRawSetting("smtpHost", "smtp.example.test");
    await storage.upsertSetting("smtpPassword", PASSWORD);
    useKeys(NEW_KEY, [OLD_KEY]);
    await storage.upsertSetting("openaiApiKey", API_KEY);
    await storage.upsertSetting("anthropicApiKey", "other-key");
    // The old key goes, which takes the SMTP password with it and nothing else.
    useKeys(NEW_KEY);

    const { settings, unreadable } = await storage.getAllSettings();

    expect(unreadable).toEqual(["smtpPassword"]);
    expect(Object.fromEntries(settings.map((s) => [s.key, s.value]))).toEqual({
      smtpHost: "smtp.example.test",
      openaiApiKey: API_KEY,
      anthropicApiKey: "other-key",
    });
  });

  it("reports nothing when everything can be read", async () => {
    await storage.upsertSetting("smtpPassword", PASSWORD);

    await expect(storage.getAllSettings()).resolves.toMatchObject({
      settings: [{ key: "smtpPassword", value: PASSWORD }],
      unreadable: [],
    });
  });
});

describe("sending email", () => {
  it("logs in with the real password when it can be read", async () => {
    await saveSmtpSettings();

    await expect(sendEmailDetailed(MESSAGE)).resolves.toMatchObject({
      accepted: [MESSAGE.to],
    });

    expect(smtp.recorded.logins).toEqual([
      { user: "mailer", password: PASSWORD },
    ]);
    expect(smtp.recorded.delivered).toBe(1);
  });

  it.each(UNREADABLE)(
    "sends nothing to the server with %s",
    async (_name, makeUnreadable) => {
      await saveSmtpSettings();
      await makeUnreadable();

      await expect(sendEmailDetailed(MESSAGE)).rejects.toBeInstanceOf(
        UnreadableSettingError,
      );

      expect(smtp.recorded.connections).toBe(0);
    },
  );

  it("names what's wrong and where to fix it", async () => {
    await saveSmtpSettings();
    useKeys(NEW_KEY);

    await expect(getSmtpSettings()).rejects.toThrow(
      "The saved SMTP password can't be decrypted, so email can't be sent. An administrator can enter it again under Administration > Email Settings.",
    );
  });

  it("reaches sendEmail's caller, not just a false", async () => {
    await saveSmtpSettings();
    useKeys(NEW_KEY);

    await expect(sendEmail(MESSAGE)).rejects.toBeInstanceOf(
      UnreadableSettingError,
    );
    expect(smtp.recorded.connections).toBe(0);
  });

  it("reaches the callers of the invitation and reset emails", async () => {
    await saveSmtpSettings();
    useKeys(NEW_KEY);

    await expect(
      sendInvitationEmail(MESSAGE.to, "invite-token"),
    ).rejects.toBeInstanceOf(UnreadableSettingError);
    await expect(
      sendPasswordResetEmail(MESSAGE.to, "reset-token"),
    ).rejects.toBeInstanceOf(UnreadableSettingError);
    expect(smtp.recorded.connections).toBe(0);
  });

  it("still sends with credentials of its own, as the email tool does", async () => {
    await saveSmtpSettings();
    useKeys(NEW_KEY);

    await sendEmailDetailed(MESSAGE, {
      host: "127.0.0.1",
      port: smtp.port,
      user: "tool-user",
      password: "tool-password",
      fromEmail: "tool@example.test",
      fromName: "Tool",
    });

    expect(smtp.recorded.logins).toEqual([
      { user: "tool-user", password: "tool-password" },
    ]);
  });

  it("isn't stopped by an AI key that can't be read", async () => {
    await storage.upsertSetting("openaiApiKey", API_KEY);
    useKeys(NEW_KEY);
    await saveSmtpSettings();

    await sendEmailDetailed(MESSAGE);

    expect(smtp.recorded.logins).toEqual([
      { user: "mailer", password: PASSWORD },
    ]);
    expect(logged.join("\n")).not.toContain("openaiApiKey");
  });

  it("still reports a server with no SMTP settings as not configured", async () => {
    await expect(sendEmailDetailed(MESSAGE)).rejects.toThrow(
      "SMTP_CONFIG_MISSING",
    );
  });
});

describe("admin.getSystemSettings", () => {
  it.each(UNREADABLE)(
    "keeps loading with %s",
    async (_name, makeUnreadable) => {
      await seedRawSetting("smtpHost", "smtp.example.test");
      const stored = await makeUnreadable();
      const admin = await seedAdmin();

      const { data } = await callerFor(admin).admin.getSystemSettings();

      expect(data).toMatchObject({
        smtpHost: "smtp.example.test",
        smtpPassword: "",
        hasSmtpPassword: false,
        unreadableSecrets: ["smtpPassword"],
      });
      expect(JSON.stringify(data)).not.toContain(stored);
    },
  );

  it("reports a secret that can be read as configured", async () => {
    await storage.upsertSetting("smtpPassword", PASSWORD);
    const admin = await seedAdmin();

    const { data } = await callerFor(admin).admin.getSystemSettings();

    expect(data).toMatchObject({
      smtpPassword: "",
      hasSmtpPassword: true,
      unreadableSecrets: [],
    });
    expect(JSON.stringify(data)).not.toContain(PASSWORD);
  });

  it("reports each AI key on its own", async () => {
    await storage.upsertSetting("openaiApiKey", API_KEY);
    await storage.upsertSetting("geminiApiKey", "other-key");
    await seedRawSetting(
      "anthropicApiKey",
      staticAadCiphertext(NEW_KEY, "a key under another key"),
    );
    const admin = await seedAdmin();

    const { data } = await callerFor(admin).admin.getSystemSettings();

    expect(data).toMatchObject({
      hasOpenaiApiKey: true,
      hasGeminiApiKey: true,
      hasAnthropicApiKey: false,
      hasCustomAiApiKey: false,
      unreadableSecrets: ["anthropicApiKey"],
    });
  });

  it("clears once the value is entered again, and a blank save doesn't do that", async () => {
    await saveSmtpSettings();
    useKeys(NEW_KEY);
    const admin = await seedAdmin();
    const caller = callerFor(admin);

    await caller.admin.updateSystemSettings({
      smtpHost: "127.0.0.1",
      smtpPassword: "",
    });
    await expect(caller.admin.getSystemSettings()).resolves.toMatchObject({
      data: { hasSmtpPassword: false, unreadableSecrets: ["smtpPassword"] },
    });

    await caller.admin.updateSystemSettings({ smtpPassword: "typed-again" });
    await expect(caller.admin.getSystemSettings()).resolves.toMatchObject({
      data: { hasSmtpPassword: true, unreadableSecrets: [] },
    });
    await expect(
      caller.admin.sendTestEmail({ to: MESSAGE.to }),
    ).resolves.toMatchObject({ success: true });
    expect(smtp.recorded.logins).toEqual([
      { user: "mailer", password: "typed-again" },
    ]);
  });
});

describe("admin send paths", () => {
  async function setUp() {
    await saveSmtpSettings();
    useKeys(NEW_KEY);
    return callerFor(await seedAdmin());
  }

  it("sendTestEmail says why", async () => {
    const caller = await setUp();

    await expect(
      caller.admin.sendTestEmail({ to: MESSAGE.to }),
    ).resolves.toEqual({
      success: false,
      message:
        "The saved SMTP password can't be decrypted, so email can't be sent. An administrator can enter it again under Administration > Email Settings.",
    });
    expect(smtp.recorded.connections).toBe(0);
  });

  it("inviteUser creates the user and says the invitation didn't go", async () => {
    const caller = await setUp();

    const response = await caller.admin.inviteUser({
      email: "invited@example.test",
      role: UserRole.USER,
    });

    expect(response.warning).toMatch(
      /^The user was created, but no invitation was sent\. The saved SMTP password can't be decrypted/,
    );
    expect(response.message).toBe(response.warning);
    await expect(
      storage.getUserByEmail("invited@example.test"),
    ).resolves.toMatchObject({ status: UserStatus.INVITED });
    expect(smtp.recorded.connections).toBe(0);
  });

  it("inviteUser has no warning when the invitation goes", async () => {
    await saveSmtpSettings();
    const caller = callerFor(await seedAdmin());

    const response = await caller.admin.inviteUser({
      email: "invited@example.test",
      role: UserRole.USER,
    });

    expect(response.warning).toBeUndefined();
    expect(response.message).toBe("Invitation sent successfully");
    expect(smtp.recorded.logins).toEqual([
      { user: "mailer", password: PASSWORD },
    ]);
  });

  it("resendInvitation says why", async () => {
    const caller = await setUp();
    const invited = await seedUser({ status: UserStatus.INVITED });

    await expect(
      caller.admin.resendInvitation({ id: invited }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "The saved SMTP password can't be decrypted, so email can't be sent. An administrator can enter it again under Administration > Email Settings.",
    });
    expect(smtp.recorded.connections).toBe(0);
  });

  it("a bulk resend says why on the row", async () => {
    const caller = await setUp();
    const invited = await seedUser({ status: UserStatus.INVITED });

    const { results } = await caller.admin.bulkUserOperation({
      userIds: [invited],
      operation: "resend_invite",
    });

    expect(results).toEqual([
      {
        id: invited,
        success: false,
        error:
          "The saved SMTP password can't be decrypted, so email can't be sent. An administrator can enter it again under Administration > Email Settings.",
      },
    ]);
    expect(smtp.recorded.connections).toBe(0);
  });
});

describe("userAuth.forgotPassword", () => {
  const seedAccount = () =>
    seedUser({
      email: "alice@example.test",
      status: UserStatus.ACTIVE,
      sessionVersion: 1,
    });

  const resetTokenCount = async () => {
    const { rows } = await pool.query<{ count: string }>(
      `SELECT count(*) FROM password_reset_tokens`,
    );
    return Number(rows[0]!.count);
  };

  it("sends the reset with the real password when it can be read", async () => {
    await saveSmtpSettings();
    await seedAccount();

    await expect(
      anonymousCaller().userAuth.forgotPassword({
        email: "alice@example.test",
      }),
    ).resolves.toMatchObject({ success: true });

    await waitUntil(() => smtp.recorded.delivered === 1);
    expect(smtp.recorded.logins).toEqual([
      { user: "mailer", password: PASSWORD },
    ]);
    expect(await resetTokenCount()).toBe(1);
  });

  it("answers as an unconfigured server does, for any email, and sends nothing", async () => {
    await saveSmtpSettings();
    const stored = await storedValue("smtpPassword");
    useKeys(NEW_KEY);
    await seedAccount();

    const registered = await anonymousCaller()
      .userAuth.forgotPassword({ email: "alice@example.test" })
      .catch((error: unknown) => error);
    const unknown = await anonymousCaller()
      .userAuth.forgotPassword({ email: "nobody@example.test" })
      .catch((error: unknown) => error);

    const answer = {
      code: "BAD_REQUEST",
      message: "Email is not configured. Please contact your administrator.",
    };
    expect(registered).toMatchObject(answer);
    expect(unknown).toMatchObject(answer);
    expect(await resetTokenCount()).toBe(0);
    expect(smtp.recorded.connections).toBe(0);
    // The sign an administrator gets, apart from the admin page.
    expect(logged.join("\n")).toContain("System setting smtpPassword");
    expect(logged.join("\n")).not.toContain(stored);
  });
});

describe("the AI provider keys", () => {
  it("sends the real key when it can be read", async () => {
    await saveAiSettings();
    const caller = callerFor(await seedAdmin());

    await expect(
      caller.ai.generateScript({ prompt: "say hello", scriptType: "BASH" }),
    ).resolves.toMatchObject({ data: { code: "echo hello" } });

    expect(aiEndpoint.requests).toEqual([
      {
        url: "/v1/chat/completions",
        authorization: `Bearer ${API_KEY}`,
      },
    ]);
  });

  it("generateScript says why, and sends nothing to the provider", async () => {
    await saveAiSettings();
    useKeys(NEW_KEY);
    const caller = callerFor(
      await seedUser({
        role: UserRole.USER,
        status: UserStatus.ACTIVE,
        sessionVersion: 1,
      }),
    );

    await expect(
      caller.ai.generateScript({ prompt: "say hello", scriptType: "BASH" }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message:
        "The saved API key for the custom AI provider can't be decrypted, so it can't be used. An administrator can enter it again under Administration > AI Assistant.",
    });
    expect(aiEndpoint.requests).toEqual([]);
  });

  it("generateScript still says when there's no key at all", async () => {
    await saveAiSettings();
    await pool.query(
      `DELETE FROM system_settings WHERE key = 'customAiApiKey'`,
    );
    const caller = callerFor(await seedAdmin());

    await expect(
      caller.ai.generateScript({ prompt: "say hello", scriptType: "BASH" }),
    ).rejects.toMatchObject({
      code: "PRECONDITION_FAILED",
      message: "AI provider API key not configured",
    });
  });

  it("isn't stopped by another provider's key that can't be read", async () => {
    await saveAiSettings();
    await seedRawSetting(
      "anthropicApiKey",
      staticAadCiphertext(NEW_KEY, "a key under another key"),
    );
    const caller = callerFor(await seedAdmin());

    await caller.ai.generateScript({
      prompt: "say hello",
      scriptType: "BASH",
    });

    expect(aiEndpoint.requests).toHaveLength(1);
    await expect(storage.getAllSettings()).resolves.toMatchObject({
      unreadable: ["anthropicApiKey"],
    });
  });

  it.each([
    ["openai", "openaiApiKey", "OpenAI API key"],
    ["anthropic", "anthropicApiKey", "Anthropic API key"],
    ["gemini", "geminiApiKey", "Google AI API key"],
    ["custom", "customAiApiKey", "API key for the custom AI provider"],
  ] as const)(
    "getAiConfig refuses the %s provider's key when it can't decrypt it",
    async (provider, key, name) => {
      await storage.upsertSetting("aiProvider", provider);
      await storage.upsertSetting(key, API_KEY);
      useKeys(NEW_KEY);

      const failure = await getAiConfig().catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(UnreadableSettingError);
      expect((failure as UnreadableSettingError).key).toBe(key);
      expect((failure as UnreadableSettingError).message).toContain(
        `The saved ${name} can't be decrypted`,
      );
      await expect(isAiConfigured()).rejects.toBeInstanceOf(
        UnreadableSettingError,
      );
    },
  );

  it("uses OPENAI_API_KEY, which takes precedence, without reading a saved key it can't decrypt", async () => {
    await storage.upsertSetting("aiProvider", "openai");
    await storage.upsertSetting("openaiApiKey", API_KEY);
    useKeys(NEW_KEY);
    process.env.OPENAI_API_KEY = "key-from-the-environment";

    await expect(getAiConfig()).resolves.toMatchObject({
      apiKey: "key-from-the-environment",
    });
    await expect(isAiConfigured()).resolves.toBe(true);
    expect(logged).toEqual([]);
  });

  describe("listing models", () => {
    it("uses the saved key when it can be read", async () => {
      await saveAiSettings();

      await expect(listAvailableModels("custom")).resolves.toMatchObject({
        source: "provider",
        models: [{ id: "llama3" }],
      });
      expect(aiEndpoint.requests).toEqual([
        { url: "/v1/models", authorization: `Bearer ${API_KEY}` },
      ]);
    });

    it("admin.listAiModels falls back and says why, and sends nothing", async () => {
      await saveAiSettings();
      useKeys(NEW_KEY);
      const caller = callerFor(await seedAdmin());

      const { data } = await caller.admin.listAiModels({ provider: "custom" });

      expect(data.source).toBe("fallback");
      expect(data.error).toContain(
        "The saved API key for the custom AI provider can't be decrypted",
      );
      expect(aiEndpoint.requests).toEqual([]);
    });

    it("ai.listModels falls back and says why, for a user with no key typed", async () => {
      await saveAiSettings();
      useKeys(NEW_KEY);
      const caller = callerFor(await seedAdmin());

      const { data } = await caller.ai.listModels({ provider: "custom" });

      expect(data.source).toBe("fallback");
      expect(data.error).toContain("can't be decrypted");
      expect(aiEndpoint.requests).toEqual([]);
    });

    it("still uses a key typed into the form, without reading the saved one", async () => {
      await saveAiSettings();
      useKeys(NEW_KEY);
      const caller = callerFor(await seedAdmin());

      const { data } = await caller.admin.listAiModels({
        provider: "custom",
        apiKey: "typed-key",
      });

      expect(data).toMatchObject({ source: "provider", error: undefined });
      expect(aiEndpoint.requests).toEqual([
        { url: "/v1/models", authorization: "Bearer typed-key" },
      ]);
      expect(logged).toEqual([]);
    });
  });
});
