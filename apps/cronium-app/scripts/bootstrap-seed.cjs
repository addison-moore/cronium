const crypto = require("crypto");
const { Pool } = require("pg");
const bcrypt = require("bcrypt");
const { nanoid } = require("nanoid");

const shouldSeed =
  (process.env.AUTO_SEED_ADMIN ?? "false").toLowerCase() === "true";

if (!shouldSeed) {
  process.exit(0);
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[SEED] DATABASE_URL is required for bootstrap seeding");
  process.exit(1);
}

const adminUsername = process.env.ADMIN_USERNAME || "admin";
const adminEmail = process.env.ADMIN_EMAIL || "admin@example.com";
const adminPassword = process.env.ADMIN_PASSWORD;

if (!adminPassword) {
  console.error(
    "[SEED] AUTO_SEED_ADMIN=true requires ADMIN_PASSWORD to be set — there is no default password. " +
      "Either set ADMIN_PASSWORD, or unset AUTO_SEED_ADMIN and create the admin account in the browser on first visit.",
  );
  process.exit(1);
}

const smtpConfig = {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  fromEmail: process.env.SMTP_FROM_EMAIL,
};

const pool = new Pool({ connectionString: databaseUrl });

// Mirrors EncryptionService.encrypt in src/lib/encryption-service.ts so seeded
// sensitive settings (smtpPassword) match what the admin UI stores.
function encryptSensitiveValue(plaintext) {
  const masterKeyHex = process.env.ENCRYPTION_KEY;
  if (!masterKeyHex || !/^[0-9a-fA-F]{64}$/.test(masterKeyHex)) {
    console.error(
      "[SEED] ENCRYPTION_KEY must be exactly 64 hex characters (openssl rand -hex 32); " +
        "refusing to store a sensitive setting unencrypted",
    );
    process.exit(1);
  }
  const masterKey = Buffer.from(masterKeyHex, "hex");
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv("aes-256-gcm", masterKey, iv);
  cipher.setAAD(Buffer.from("cronium-server-encryption"));
  const encrypted = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return Buffer.concat([iv, encrypted, cipher.getAuthTag()]).toString(
    "base64",
  );
}

async function ensureAdmin() {
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `select id from users where username = $1 or email = $2 limit 1`,
      [adminUsername, adminEmail],
    );

    if (existing.rows.length > 0) {
      console.log("[SEED] Admin user already exists; skipping creation");
      return;
    }

    const hashed = await bcrypt.hash(adminPassword, 10);
    const now = new Date();
    const id = nanoid();

    await client.query(
      `insert into users (id, username, email, password, role, status, created_at, updated_at)
       values ($1, $2, $3, $4, 'ADMIN', 'ACTIVE', $5, $5)`,
      [id, adminUsername, adminEmail, hashed, now],
    );

    console.log(
      `[SEED] Created admin user (username: ${adminUsername}, email: ${adminEmail})`,
    );
    if (
      adminUsername === "admin" &&
      adminEmail === "admin@example.com" &&
      adminPassword === "admin"
    ) {
      console.warn(
        "[SEED] Default admin credentials in use; ensure password/email are changed after first login",
      );
    }
  } finally {
    client.release();
  }
}

async function ensureSetting(key, value) {
  const client = await pool.connect();
  try {
    const existing = await client.query(
      `select id from system_settings where key = $1 limit 1`,
      [key],
    );
    if (existing.rows.length > 0) {
      return;
    }
    const now = new Date();
    await client.query(
      `insert into system_settings (key, value, created_at, updated_at)
       values ($1, $2, $3, $3)`,
      [key, value, now],
    );
    const loggedValue = key === "smtpPassword" ? "[redacted]" : value;
    console.log(`[SEED] Set default system setting ${key}=${loggedValue}`);
  } finally {
    client.release();
  }
}

async function ensureRegistrationDefaults() {
  await ensureSetting("allowRegistration", "false");
  await ensureSetting("requireAdminApproval", "false");
}

async function ensureSmtpDefaults() {
  if (
    !smtpConfig.host &&
    !smtpConfig.port &&
    !smtpConfig.user &&
    !smtpConfig.password &&
    !smtpConfig.fromEmail
  ) {
    return;
  }

  const pairs = [
    ["smtpHost", smtpConfig.host],
    ["smtpPort", smtpConfig.port],
    ["smtpUser", smtpConfig.user],
    [
      "smtpPassword",
      smtpConfig.password
        ? encryptSensitiveValue(String(smtpConfig.password))
        : smtpConfig.password,
    ],
    ["smtpFromEmail", smtpConfig.fromEmail],
  ];

  for (const [key, value] of pairs) {
    if (value !== undefined && value !== null && value !== "") {
      await ensureSetting(key, String(value));
    }
  }
}

// Mirror of src/scripts/seed-roles.ts for container boots: insert-if-missing
// only, so admin-customized permissions are never overwritten.
const DEFAULT_ROLES = [
  {
    name: "Admin",
    description: "Administrators with full access",
    permissions: { console: true, monitoring: true, localServerAccess: true },
    isDefault: false,
  },
  {
    name: "User",
    description: "Default role for regular users",
    permissions: { console: true, monitoring: true, localServerAccess: false },
    isDefault: true,
  },
  {
    name: "Viewer",
    description: "Read-only users",
    permissions: { console: false, monitoring: true, localServerAccess: false },
    isDefault: false,
  },
];

async function ensureRoles() {
  const client = await pool.connect();
  try {
    for (const role of DEFAULT_ROLES) {
      const existing = await client.query(
        `select id from roles where lower(name) = lower($1) limit 1`,
        [role.name],
      );
      if (existing.rows.length > 0) {
        continue;
      }
      const now = new Date();
      await client.query(
        `insert into roles (name, description, permissions, is_default, created_at, updated_at)
         values ($1, $2, $3, $4, $5, $5)`,
        [
          role.name,
          role.description,
          JSON.stringify(role.permissions),
          role.isDefault,
          now,
        ],
      );
      console.log(`[SEED] Created role ${role.name}`);
    }

    // Assign the default role to users without one
    await client.query(
      `update users set role_id = (select id from roles where is_default = true limit 1)
       where role_id is null`,
    );
  } finally {
    client.release();
  }
}

async function ensureSeedMarker() {
  await ensureSetting("bootstrapSeedComplete", "true");
}

async function main() {
  try {
    console.log("[SEED] Bootstrap seeding enabled (AUTO_SEED_ADMIN=true)");
    await ensureAdmin();
    await ensureRoles();
    await ensureRegistrationDefaults();
    await ensureSmtpDefaults();
    await ensureSeedMarker();
    console.log("[SEED] Bootstrap seeding complete");
  } catch (err) {
    console.error("[SEED] Bootstrap seeding failed", err);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

void main();
