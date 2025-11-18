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
const adminPassword = process.env.ADMIN_PASSWORD || "admin";

const smtpConfig = {
  host: process.env.SMTP_HOST,
  port: process.env.SMTP_PORT,
  user: process.env.SMTP_USER,
  password: process.env.SMTP_PASSWORD,
  fromEmail: process.env.SMTP_FROM_EMAIL,
};

const pool = new Pool({ connectionString: databaseUrl });

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
    console.log(`[SEED] Set default system setting ${key}=${value}`);
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
    ["smtpPassword", smtpConfig.password],
    ["smtpFromEmail", smtpConfig.fromEmail],
  ];

  for (const [key, value] of pairs) {
    if (value !== undefined && value !== null && value !== "") {
      await ensureSetting(key, String(value));
    }
  }
}

async function ensureSeedMarker() {
  await ensureSetting("bootstrapSeedComplete", "true");
}

async function main() {
  try {
    console.log("[SEED] Bootstrap seeding enabled (AUTO_SEED_ADMIN=true)");
    await ensureAdmin();
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
