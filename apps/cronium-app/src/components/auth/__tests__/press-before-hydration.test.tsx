/**
 * A server-rendered form can be pressed before React arrives. With no `action` that's the
 * browser's own GET, with the password in the URL, the history, the `Referer` and a reverse
 * proxy's access log. These run the real path: React's server renderer, its inline script, a
 * press in the DOM with no React on the page, and then hydrateRoot.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { startTransition, Suspense, type ReactElement } from "react";
import { hydrateRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { fireEvent, waitFor } from "@testing-library/react";
import SignIn from "@/app/(auth)/auth/signin/signin-form";
import ForgotPassword from "@/app/(auth)/auth/forgot-password/page";
import SetupForm from "@/components/auth/SetupForm";
import SignUpForm from "@/components/auth/SignUpForm";
import { SmtpSettings } from "@/components/admin/smtp-settings";
import ServerForm from "@/components/dashboard/ServerForm";

const mockLogin = jest.fn();
const mockRegister = jest.fn();
const mockForgotPassword = jest.fn();
const mockCreateServer = jest.fn();
const mockSignIn = jest.fn();
const mockCreateFirstAdmin = jest.fn();
const mockPush = jest.fn();
let mockSearchParams = new URLSearchParams();

jest.mock("@/lib/trpc", () => ({
  trpc: {
    userAuth: {
      login: { useMutation: () => ({ mutateAsync: mockLogin }) },
      register: { useMutation: () => ({ mutateAsync: mockRegister }) },
      forgotPassword: {
        useMutation: () => ({ mutate: mockForgotPassword, isPending: false }),
      },
    },
    servers: {
      create: {
        useMutation: () => ({
          mutateAsync: mockCreateServer,
          isPending: false,
        }),
      },
      update: {
        useMutation: () => ({ mutateAsync: jest.fn(), isPending: false }),
      },
    },
  },
}));

jest.mock("next-auth/react", () => ({
  signIn: (...args: unknown[]) => mockSignIn(...args) as unknown,
}));

jest.mock("@/app/(auth)/auth/setup/actions", () => ({
  createFirstAdmin: (...args: unknown[]) =>
    mockCreateFirstAdmin(...args) as unknown,
}));

jest.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: jest.fn() }),
  useSearchParams: () => mockSearchParams,
}));

const SECRET = "Correct-Horse-Battery-9";

type ReplayQueue = unknown[];
const replayQueue = () =>
  (document as unknown as { $$reactFormReplay?: ReplayQueue })
    .$$reactFormReplay ?? [];

// One listener per page in a browser, and it never goes away, so it only needs running once.
let ranReactsScript = false;

/**
 * Next renders every page inside Suspense boundaries, and React treats a boundary differently
 * when it hydrates: its effects run at idle priority, and only a press in a boundary can be
 * replayed. A form hydrated at the root passes these tests when it doesn't work in a browser.
 */
const inBoundary = (ui: ReactElement) => (
  <Suspense fallback={null}>{ui}</Suspense>
);

/** What a browser has once the server's HTML has arrived, before any of the app's scripts. */
function serve(ui: ReactElement) {
  const container = document.createElement("div");
  container.innerHTML = renderToString(inBoundary(ui));
  document.body.appendChild(container);
  // Setting innerHTML doesn't run scripts, and a browser would run this one.
  for (const script of container.querySelectorAll("script")) {
    if (!ranReactsScript) window.eval(script.textContent);
    ranReactsScript = true;
    script.remove();
  }
  const form = container.querySelector("form");
  if (!form) throw new Error("the server sent no form");
  return { container, form };
}

function field(form: HTMLFormElement, name: string) {
  const el = form.elements.namedItem(name);
  if (!(el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement)) {
    throw new Error(`no field named ${name}`);
  }
  return el;
}

/** Typed with no React on the page, so no handler sees it and only the DOM has it. */
function fillBeforeHydration(
  form: HTMLFormElement,
  values: Record<string, string>,
) {
  for (const [name, value] of Object.entries(values)) {
    field(form, name).value = value;
  }
}

function submitButton(form: HTMLFormElement) {
  const button = form.querySelector('button[type="submit"]');
  if (!button) throw new Error("no submit button");
  return button;
}

/** A press with no React on the page, reporting whether anything stopped the browser's own. */
function pressBeforeHydration(form: HTMLFormElement) {
  let reachedTheBrowser = false;
  const listener = (event: Event) => {
    reachedTheBrowser = !event.defaultPrevented;
  };
  // After React's script in the order of listeners on window, so it sees what that script did.
  window.addEventListener("submit", listener);
  fireEvent.click(submitButton(form));
  window.removeEventListener("submit", listener);
  return { reachedTheBrowser };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

// As Next does it, on React's real scheduler and not under act(), which would flush everything
// at once and hide the order in which the work happens.
let root: Root | undefined;
async function hydrate(container: HTMLElement, ui: ReactElement) {
  startTransition(() => {
    root = hydrateRoot(container, inBoundary(ui));
  });
  await waitFor(() =>
    expect(
      Object.keys(container.querySelector("form") ?? {}).some((key) =>
        key.startsWith("__reactProps"),
      ),
    ).toBe(true),
  );
  await settle();
}

function setUpRealScheduling() {
  beforeAll(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = false;
  });
  afterEach(async () => {
    root?.unmount();
    root = undefined;
    await settle();
    document.body.innerHTML = "";
  });
}

const FORMS = [
  {
    name: "sign-in",
    ui: () => <SignIn />,
    typed: { username: "ada", password: SECRET },
    called: () => mockLogin,
    expected: { username: "ada", password: SECRET },
  },
  {
    name: "setup",
    ui: () => <SetupForm />,
    typed: {
      username: "ada",
      email: "ada@example.com",
      password: SECRET,
      confirmPassword: SECRET,
    },
    called: () => mockCreateFirstAdmin,
    expected: { username: "ada", email: "ada@example.com", password: SECRET },
  },
  {
    name: "setup with its token",
    ui: () => <SetupForm bootstrapTokenRequired />,
    typed: {
      username: "ada",
      email: "ada@example.com",
      password: SECRET,
      confirmPassword: SECRET,
      bootstrapToken: "installer-token",
    },
    called: () => mockCreateFirstAdmin,
    expected: {
      username: "ada",
      email: "ada@example.com",
      password: SECRET,
      bootstrapToken: "installer-token",
    },
  },
  {
    name: "sign-up",
    ui: () => <SignUpForm />,
    typed: {
      username: "ada",
      email: "ada@example.com",
      password: SECRET,
      confirmPassword: SECRET,
    },
    called: () => mockRegister,
    expected: { username: "ada", email: "ada@example.com", password: SECRET },
  },
  {
    name: "forgot password",
    ui: () => <ForgotPassword />,
    typed: { email: "ada@example.com" },
    called: () => mockForgotPassword,
    expected: { email: "ada@example.com" },
  },
];

describe("auth forms before hydration", () => {
  setUpRealScheduling();

  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    mockSearchParams = new URLSearchParams();
    mockLogin.mockResolvedValue({ success: true });
    mockRegister.mockResolvedValue({ status: "ACTIVE" });
    mockSignIn.mockResolvedValue({ ok: true });
    mockCreateFirstAdmin.mockResolvedValue({ success: true });
    consoleError = jest.spyOn(console, "error");
  });

  afterEach(() => {
    // The server's form and the client's have to match, or React throws the HTML away and
    // renders it again, losing what was typed.
    const hydrationErrors = consoleError.mock.calls.filter((args) =>
      String(args[0]).toLowerCase().includes("hydrat"),
    );
    expect(hydrationErrors).toEqual([]);
    consoleError.mockRestore();
  });

  describe.each(FORMS)("$name", ({ ui, typed, called, expected }) => {
    it("is served so that the browser can't submit it anywhere", () => {
      const { form } = serve(ui());
      expect(form.getAttribute("action")).toMatch(/^javascript:/);
    });

    it("holds a press, then acts on it once React has arrived", async () => {
      const { container, form } = serve(ui());
      fillBeforeHydration(form, typed);

      const { reachedTheBrowser } = pressBeforeHydration(form);

      expect(reachedTheBrowser).toBe(false);
      expect(replayQueue()).toHaveLength(3);
      expect(called()).not.toHaveBeenCalled();

      await hydrate(container, ui());

      await waitFor(() => expect(called()).toHaveBeenCalledTimes(1));
      expect(called().mock.calls[0][0]).toEqual(expected);
      expect(replayQueue()).toHaveLength(0);
    });

    it("keeps what was typed before React arrived, for a press after it", async () => {
      const { container, form } = serve(ui());
      fillBeforeHydration(form, typed);

      await hydrate(container, ui());

      // React doesn't read an input when it hydrates it, so the form's state started out
      // empty, and its next render used to put that in the input.
      for (const [name, value] of Object.entries(typed)) {
        expect(field(form, name).value).toBe(value);
      }
      fireEvent.click(submitButton(form));
      await waitFor(() => expect(called()).toHaveBeenCalledTimes(1));
      expect(called().mock.calls[0][0]).toEqual(expected);
    });

    it("sends an ordinary press once, through onSubmit", async () => {
      const { container, form } = serve(ui());
      await hydrate(container, ui());

      for (const [name, value] of Object.entries(typed)) {
        fireEvent.change(field(form, name), { target: { value } });
      }
      fireEvent.click(submitButton(form));

      await waitFor(() => expect(called()).toHaveBeenCalledTimes(1));
      await settle();
      expect(called()).toHaveBeenCalledTimes(1);
      expect(called().mock.calls[0][0]).toEqual(expected);
      expect(replayQueue()).toHaveLength(0);
    });
  });

  it("counts two early presses as one", async () => {
    const { container, form } = serve(<SignIn />);
    fillBeforeHydration(form, { username: "ada", password: SECRET });

    pressBeforeHydration(form);
    pressBeforeHydration(form);
    expect(replayQueue()).toHaveLength(6);

    await hydrate(container, <SignIn />);

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));
    await settle();
    expect(mockLogin).toHaveBeenCalledTimes(1);
  });

  it("submits what's in the fields when React arrives, not when they were pressed", async () => {
    const { container, form } = serve(<SignIn />);
    fillBeforeHydration(form, { username: "ada", password: "a typo" });
    pressBeforeHydration(form);
    fillBeforeHydration(form, { password: SECRET });

    await hydrate(container, <SignIn />);

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));
    expect(mockLogin).toHaveBeenCalledWith({
      username: "ada",
      password: SECRET,
    });
  });

  it("shows that it's busy while an early press is being handled", async () => {
    mockLogin.mockReturnValue(new Promise(() => undefined));
    const { container, form } = serve(<SignIn />);
    fillBeforeHydration(form, { username: "ada", password: SECRET });
    pressBeforeHydration(form);

    await hydrate(container, <SignIn />);

    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(1));
    await waitFor(() =>
      expect(submitButton(form)).toHaveTextContent("Signing in..."),
    );
    expect(submitButton(form)).toBeDisabled();
  });

  it("goes to the callback URL after an early press", async () => {
    mockSearchParams = new URLSearchParams("callbackUrl=/dashboard/settings");
    const { container, form } = serve(<SignIn />);
    fillBeforeHydration(form, { username: "ada", password: SECRET });
    pressBeforeHydration(form);

    await hydrate(container, <SignIn />);

    await waitFor(() =>
      expect(mockPush).toHaveBeenCalledWith("/dashboard/settings"),
    );
  });

  it("keeps the fields after an early press that fails", async () => {
    mockLogin.mockResolvedValue({ success: false });
    const { container, form } = serve(<SignIn />);
    fillBeforeHydration(form, { username: "ada", password: SECRET });
    pressBeforeHydration(form);

    await hydrate(container, <SignIn />);

    await waitFor(() =>
      expect(container).toHaveTextContent(
        "Invalid username/email or password.",
      ),
    );
    // React resets a form when its action finishes, which mustn't reach what the person typed.
    await settle();
    expect(field(form, "username").value).toBe("ada");
    expect(field(form, "password").value).toBe(SECRET);
    fireEvent.click(submitButton(form));
    await waitFor(() => expect(mockLogin).toHaveBeenCalledTimes(2));
    expect(mockLogin).toHaveBeenLastCalledWith({
      username: "ada",
      password: SECRET,
    });
  });

  it("asks for the second factor after an early press", async () => {
    mockLogin.mockResolvedValue({ success: false, mfaRequired: true });
    const { container, form } = serve(<SignIn />);
    // Nothing to leak: the code's field isn't there until the server has asked for it.
    expect(form.elements.namedItem("totp")).toBeNull();
    fillBeforeHydration(form, { username: "ada", password: SECRET });
    pressBeforeHydration(form);

    await hydrate(container, <SignIn />);

    await waitFor(() => expect(form.elements.namedItem("totp")).not.toBeNull());
    expect(field(form, "password").value).toBe(SECRET);

    mockLogin.mockResolvedValue({ success: true });
    fireEvent.change(field(form, "totp"), { target: { value: "123456" } });
    fireEvent.click(submitButton(form));
    await waitFor(() =>
      expect(mockLogin).toHaveBeenLastCalledWith({
        username: "ada",
        password: SECRET,
        totp: "123456",
      }),
    );
  });
});

// These hold a secret and can't act on a press before hydration, so it does nothing.
describe("dashboard forms before hydration", () => {
  setUpRealScheduling();

  const onSave = jest.fn();
  const SETTINGS = { smtpHost: "mail.example.com", smtpPort: 587 };

  const SECRET_FORMS = [
    {
      name: "SMTP settings",
      ui: () => <SmtpSettings settings={SETTINGS} onSave={onSave} />,
      typed: { smtpPassword: SECRET },
      called: () => onSave,
      ordinary: {},
    },
    {
      name: "add a server",
      ui: () => <ServerForm isEditing={false} />,
      typed: { sshKey: "-----BEGIN OPENSSH PRIVATE KEY-----" },
      called: () => mockCreateServer,
      ordinary: {
        name: "web",
        address: "10.0.0.1",
        username: "root",
        sshKey: "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n",
      },
    },
  ];

  beforeEach(() => {
    jest.clearAllMocks();
    onSave.mockResolvedValue(undefined);
    mockCreateServer.mockResolvedValue({ id: 1 });
  });

  describe.each(SECRET_FORMS)("$name", ({ ui, typed, called, ordinary }) => {
    it("is served so that the browser can't submit it anywhere", () => {
      const { form } = serve(ui());
      expect(form.getAttribute("action")).toMatch(/^javascript:/);
    });

    it("drops a press before hydration, and doesn't act on it afterwards", async () => {
      const { container, form } = serve(ui());
      fillBeforeHydration(form, typed);

      const { reachedTheBrowser } = pressBeforeHydration(form);
      expect(reachedTheBrowser).toBe(false);

      await hydrate(container, ui());
      await settle();

      expect(called()).not.toHaveBeenCalled();
      expect(replayQueue()).toHaveLength(0);
      // Not even validated, or the person gets errors about a press that does nothing.
      expect(form.querySelectorAll('[aria-invalid="true"]')).toHaveLength(0);
    });

    it("saves on an ordinary press", async () => {
      const { container, form } = serve(ui());
      await hydrate(container, ui());

      for (const [name, value] of Object.entries(ordinary)) {
        fireEvent.change(field(form, name), { target: { value } });
      }
      fireEvent.click(submitButton(form));

      await waitFor(() => expect(called()).toHaveBeenCalledTimes(1));
    });
  });
});

describe("forms on the auth pages", () => {
  // Rendered only after hydration, so there's nothing to press before it. The first load shows
  // a spinner or a message until an effect or a query has run.
  const RENDERED_AFTER_HYDRATION = new Set([
    "activate/page.tsx",
    "reset-password/page.tsx",
  ]);
  const AUTH_PAGES = path.resolve(__dirname, "../../../app/(auth)/auth");
  const files = (readdirSync(AUTH_PAGES, { recursive: true }) as string[])
    .filter((file) => file.endsWith(".tsx"))
    .map((file) => ({ file, source: path.join(AUTH_PAGES, file) }));
  const sharedForms = ["SetupForm.tsx", "SignUpForm.tsx"].map((file) => ({
    file,
    source: path.resolve(__dirname, "..", file),
  }));

  it.each([...files, ...sharedForms])(
    "$file keeps a press before hydration out of the URL",
    ({ file, source }) => {
      const code = readFileSync(source, "utf8");
      if (!code.includes("<form") || RENDERED_AFTER_HYDRATION.has(file)) return;
      expect(code).toContain("{...earlyInput}");
    },
  );
});
