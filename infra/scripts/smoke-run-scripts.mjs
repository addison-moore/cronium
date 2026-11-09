#!/usr/bin/env node
/**
 * Runs a script in each language on a running stack, end to end: the job image and the
 * runtime sidecar have to be there or be pulled, and each script reads back a variable it
 * set through the SDK. Install Smoke runs this, because a stack can report every service
 * healthy and still have nothing to run a script in.
 *
 * Needs an existing user, in SMOKE_USERNAME and SMOKE_PASSWORD. No dependencies, so it runs
 * on a CI runner's own Node. Exits 1 and says why if any script doesn't finish as it should.
 */

const APP = process.env.CRONIUM_URL ?? "http://localhost:3000";
const USERNAME = process.env.SMOKE_USERNAME;
const PASSWORD = process.env.SMOKE_PASSWORD;

// A first run can include pulling the job image, which has a 5-minute limit of its own.
const RUN_LIMIT_MS = 7 * 60 * 1000;
const POLL_MS = 2000;
const FINISHED = new Set(["SUCCESS", "FAILURE", "TIMEOUT", "PARTIAL"]);

const SCRIPTS = [
  {
    type: "BASH",
    content: [
      'cronium_set_variable SMOKE_BASH "from bash"',
      'echo "read back: $(cronium_get_variable SMOKE_BASH)"',
    ].join("\n"),
    expect: "read back: from bash",
  },
  {
    type: "PYTHON",
    content: [
      "import cronium",
      'cronium.set_variable("SMOKE_PYTHON", "from python")',
      'print("read back: " + cronium.get_variable("SMOKE_PYTHON"))',
    ].join("\n"),
    expect: "read back: from python",
  },
  {
    type: "NODEJS",
    content: [
      'const cronium = require("cronium");',
      "(async () => {",
      '  await cronium.setVariable("SMOKE_NODE", "from node");',
      '  console.log("read back: " + (await cronium.getVariable("SMOKE_NODE")));',
      "})().catch((error) => {",
      "  console.error(error);",
      "  process.exit(1);",
      "});",
    ].join("\n"),
    expect: "read back: from node",
  },
];

async function request(path, init = {}) {
  const response = await fetch(`${APP}${path}`, {
    redirect: "manual",
    ...init,
  });
  const text = await response.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = undefined;
  }
  return { status: response.status, headers: response.headers, text, json };
}

function cookiesFrom(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");
}

/** A short-lived API token for the user, through the sign-in a person would use. */
async function signIn() {
  const csrf = await request("/api/auth/csrf");
  if (!csrf.json?.csrfToken) {
    throw new Error(`no CSRF token: HTTP ${csrf.status}`);
  }
  const signedIn = await request("/api/auth/callback/credentials", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      cookie: cookiesFrom(csrf),
    },
    body: new URLSearchParams({
      csrfToken: csrf.json.csrfToken,
      username: USERNAME,
      password: PASSWORD,
      callbackUrl: APP,
      json: "true",
    }),
  });
  const session = signedIn.headers
    .getSetCookie()
    .find((cookie) => /session-token=[^;]+/.test(cookie));
  if (!session) throw new Error(`sign-in failed: HTTP ${signedIn.status}`);

  const created = await request("/api/trpc/auth.createApiToken", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: session.split(";")[0],
    },
    body: JSON.stringify({
      json: { name: "install-smoke", scopes: ["full"], expiresInDays: 1 },
    }),
  });
  const token = created.json?.result?.data?.json?.displayToken;
  if (!token) {
    throw new Error(`no API token: HTTP ${created.status} ${created.text}`);
  }
  return token;
}

async function run(script, token) {
  const headers = {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
  };
  const created = await request("/api/events", {
    method: "POST",
    headers,
    body: JSON.stringify({
      name: `smoke-${script.type.toLowerCase()}`,
      type: script.type,
      content: script.content,
      status: "ACTIVE",
      triggerType: "MANUAL",
      runLocation: "LOCAL",
      scheduleUnit: "MINUTES",
      timeoutValue: 120,
      timeoutUnit: "SECONDS",
      retries: 0,
    }),
  });
  if (!created.json?.id) {
    throw new Error(`creating it: HTTP ${created.status} ${created.text}`);
  }

  const started = await request(`/api/events/${created.json.id}/execute`, {
    method: "POST",
    headers,
    body: "{}",
  });
  if (!started.json?.logId) {
    throw new Error(`starting it: HTTP ${started.status} ${started.text}`);
  }

  const deadline = Date.now() + RUN_LIMIT_MS;
  while (Date.now() < deadline) {
    const log = await request(`/api/logs/${started.json.logId}`, { headers });
    if (FINISHED.has(log.json?.status)) {
      const { status, output, error } = log.json;
      if (status !== "SUCCESS") {
        throw new Error(
          `it ended ${status}: ${error || output || "no output"}`,
        );
      }
      if (!output?.includes(script.expect)) {
        throw new Error(`it printed ${JSON.stringify(output)}`);
      }
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_MS));
  }
  throw new Error(`it hadn't finished after ${RUN_LIMIT_MS / 60000} minutes`);
}

if (!USERNAME || !PASSWORD) {
  console.error("Set SMOKE_USERNAME and SMOKE_PASSWORD.");
  process.exit(2);
}

const token = await signIn();
let failed = false;
for (const script of SCRIPTS) {
  const started = Date.now();
  try {
    await run(script, token);
    const seconds = ((Date.now() - started) / 1000).toFixed(1);
    console.log(`${script.type}: ran end to end in ${seconds}s`);
  } catch (error) {
    failed = true;
    console.error(`${script.type}: ${error.message}`);
  }
}
process.exit(failed ? 1 : 0);
