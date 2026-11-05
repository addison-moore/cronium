/**
 * Monaco must never load from a CDN. If @monaco-editor/react's loader is left
 * unconfigured it injects a <script> pointing at jsDelivr, and the production
 * CSP lets that run: 'strict-dynamic' trusts scripts inserted by a nonced
 * script. The first sign of it is the stylesheet being blocked, which only
 * shows up in a production browser, so these tests pin the wiring instead.
 */
import fs from "node:fs";
import path from "node:path";

const mockMonaco = { __esModule: true, editor: {} };

jest.mock("monaco-editor", () => mockMonaco, { virtual: true });
jest.mock("@cronium/ui", () => ({ setMonacoSetup: jest.fn() }));
jest.mock("@/components/providers/NextAuthProvider", () => ({}));
jest.mock("@/components/providers/TrpcProvider", () => ({}));
jest.mock("@/components/providers/ThemeProvider", () => ({}));

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const UI_COMPONENTS = path.join(REPO_ROOT, "packages/ui/src/components");

const injectedScript = () =>
  document.querySelector("script[src]")?.getAttribute("src");

beforeEach(() => {
  // The loader keeps its state at module level, so each test needs a fresh one.
  jest.resetModules();
  document.body.innerHTML = "";
});

describe("the @monaco-editor/react loader", () => {
  it("reaches for the CDN when it is left unconfigured", async () => {
    // Control: this is the behaviour the rest of the file guards against.
    const { loader } = await import("@monaco-editor/react");

    void loader.init();

    expect(injectedScript()).toContain("cdn.jsdelivr.net");
  });

  it("resolves to the bundled Monaco once the app's registered setup has run", async () => {
    await import("@/components/providers/Providers");
    const { setMonacoSetup } = await import("@cronium/ui");
    const [setup] = (setMonacoSetup as jest.Mock).mock.calls[0] as [
      () => Promise<void>,
    ];

    await setup();
    const { loader } = await import("@monaco-editor/react");

    await expect(loader.init()).resolves.toBe(mockMonaco);
    expect(injectedScript()).toBeUndefined();
  });

  it("is one copy shared by the app and @cronium/ui", () => {
    // The configured Monaco lives in this package's module state. With two
    // copies, the app would configure one and MonacoEditor would read the
    // other, which is the CDN fallback again with nothing to show for it.
    const loaderSeenFrom = (dir: string) => {
      const react = fs.realpathSync(
        require.resolve("@monaco-editor/react", { paths: [dir] }),
      );
      return fs.realpathSync(
        require.resolve("@monaco-editor/loader", {
          paths: [path.dirname(react)],
        }),
      );
    };

    expect(loaderSeenFrom(UI_COMPONENTS)).toBe(loaderSeenFrom(__dirname));
  });
});

describe("MonacoEnvironment.getWorker", () => {
  const OriginalWorker = global.Worker;

  afterEach(() => {
    global.Worker = OriginalWorker;
  });

  it.each([
    ["json", "language/json/json.worker.js"],
    ["css", "language/css/css.worker.js"],
    ["scss", "language/css/css.worker.js"],
    ["less", "language/css/css.worker.js"],
    ["html", "language/html/html.worker.js"],
    ["handlebars", "language/html/html.worker.js"],
    ["razor", "language/html/html.worker.js"],
    ["typescript", "language/typescript/ts.worker.js"],
    ["javascript", "language/typescript/ts.worker.js"],
    ["editorWorkerService", "editor/editor.worker.js"],
  ])("gives the %s label %s", async (label, expectedPath) => {
    const workerCtor = jest.fn();
    global.Worker = workerCtor as unknown as typeof Worker;
    const { setupMonaco } = await import("../monaco-setup");

    setupMonaco();
    const environment = (
      window as unknown as {
        MonacoEnvironment: {
          getWorker: (id: string, label: string) => Worker;
        };
      }
    ).MonacoEnvironment;
    environment.getWorker("workerMain.js", label);

    expect(String(workerCtor.mock.calls[0]?.[0])).toContain(expectedPath);
  });
});

describe("@cronium/ui MonacoEditor", () => {
  type Loader = () => Promise<{ default: unknown }>;

  async function loadWrapper() {
    let editorLoader: Loader | undefined;
    // Resolved from the UI package, where pnpm can install a different copy of
    // next than the one this app sees.
    jest.doMock(
      require.resolve("next/dynamic", { paths: [UI_COMPONENTS] }),
      () => ({
        __esModule: true,
        default: (loader: Loader) => {
          editorLoader = loader;
          return () => null;
        },
      }),
    );
    jest.doMock(
      "../../../../../packages/ui/src/components/monaco-editor",
      () => ({ MonacoEditor: "the-editor" }),
    );
    const { setMonacoSetup } =
      await import("../../../../../packages/ui/src/components/monaco-editor-lazy");
    return { setMonacoSetup, loadEditor: () => editorLoader!() };
  }

  it("refuses to load until a setup is registered", async () => {
    const { loadEditor } = await loadWrapper();

    await expect(loadEditor()).rejects.toThrow(/setMonacoSetup/);
  });

  it("waits for the setup to finish before handing over the editor", async () => {
    const { setMonacoSetup, loadEditor } = await loadWrapper();
    let finishSetup = () => {};
    setMonacoSetup(
      () =>
        new Promise<void>((resolve) => {
          finishSetup = resolve;
        }),
    );
    let handedOver = false;

    const pending = loadEditor().then((mod) => {
      handedOver = true;
      return mod;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(handedOver).toBe(false);

    finishSetup();
    await expect(pending).resolves.toEqual({ default: "the-editor" });
  });
});

describe("direct @monaco-editor/react imports", () => {
  // Anything importing this package can mount an editor without going through
  // setMonacoSetup, which puts it back on the CDN. MonacoEditor is the one
  // component that should render it; new editors should use that.
  const ALLOWED = new Set([
    "packages/ui/src/components/monaco-editor.tsx",
    "apps/cronium-app/src/lib/monaco-setup.ts",
  ]);

  function sourceFiles(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const entryPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === "__tests__" ? [] : sourceFiles(entryPath);
      }
      return /\.tsx?$/.test(entry.name) ? [entryPath] : [];
    });
  }

  it("are limited to the self-hosted paths", () => {
    const importers = [
      "apps/cronium-app/src",
      "apps/cronium-info/src",
      "packages/ui/src",
    ]
      .flatMap((dir) => sourceFiles(path.join(REPO_ROOT, dir)))
      .filter((file) =>
        /^import (?!type\b)[^;]*from "@monaco-editor\/react"/m.test(
          fs.readFileSync(file, "utf8"),
        ),
      )
      .map((file) => path.relative(REPO_ROOT, file));

    expect(importers.filter((file) => !ALLOWED.has(file))).toEqual([]);
  });
});
