/**
 * What @cronium/ui's editor components render. monaco-setup.test.ts covers how
 * Monaco gets wired up; this covers what the user sees, using the real components
 * with Monaco's React wrapper mocked.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import fs from "node:fs";
import path from "node:path";
import { useState, type ComponentType } from "react";
import type {
  EditorLanguage,
  MonacoEditorProps,
} from "../../../../../packages/ui/src/components/monaco-editor";

type Loader = () => Promise<{ default: ComponentType<MonacoEditorProps> }>;

const REPO_ROOT = path.resolve(__dirname, "../../../../..");
const UI_COMPONENTS = path.join(REPO_ROOT, "packages/ui/src/components");

const mockEditor = jest.fn();

jest.mock("@monaco-editor/react", () => ({
  __esModule: true,
  default: (props: { value?: string; language?: string }) => {
    mockEditor(props);
    return <div data-testid="monaco">{props.value}</div>;
  },
  loader: { config: jest.fn() },
}));

// The real lazy module, with `next/dynamic` swapped to expose its loader. It's
// loaded once, because a second copy would bring a second React with it, and the
// setup it holds can be replaced between tests. Resolved from the UI package, where
// pnpm can install a different copy of next than the one this app sees.
let editorLoader: Loader | undefined;
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
const { setMonacoSetup } = jest.requireActual<
  typeof import("../../../../../packages/ui/src/components/monaco-editor-lazy")
>("../../../../../packages/ui/src/components/monaco-editor-lazy");
const { MonacoEditor } = jest.requireActual<
  typeof import("../../../../../packages/ui/src/components/monaco-editor")
>("../../../../../packages/ui/src/components/monaco-editor");
const load = () => editorLoader!();

async function loadFallback() {
  setMonacoSetup(() => Promise.reject(new Error("ChunkLoadError")));
  const { default: Fallback } = await load();
  return Fallback;
}

/** The stand-in, reached the way the app reaches it: a failed download. */
async function renderFallback(
  props: MonacoEditorProps,
  setup: () => Promise<void>,
) {
  const Fallback = await loadFallback();
  setMonacoSetup(setup);
  return render(<Fallback {...props} />);
}

const stillFailing = () => Promise.reject(new Error("ChunkLoadError"));

beforeEach(() => {
  mockEditor.mockClear();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("when Monaco can't be downloaded", () => {
  it("shows the text in an editable box, with the reason", async () => {
    await renderFallback({ value: "echo hi" }, stillFailing);

    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "echo hi",
    );
    expect(screen.getByRole("alert").textContent).toContain("couldn't load");
    await screen.findByRole("button", { name: "Try again" });
  });

  it("reports edits, so the form keeps what the user types", async () => {
    const changes: string[] = [];
    function Form() {
      const [value, setValue] = useState("echo");
      return (
        <Fallback
          value={value}
          onChange={(next) => {
            changes.push(next);
            setValue(next);
          }}
        />
      );
    }
    const Fallback = await loadFallback();
    setMonacoSetup(stillFailing);
    render(<Form />);
    await screen.findByRole("button", { name: "Try again" });

    await userEvent.type(screen.getByRole("textbox"), " hi");

    expect(changes.at(-1)).toBe("echo hi");
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "echo hi",
    );
  });

  it("keeps text a caller didn't control", async () => {
    await renderFallback({ defaultValue: "start" }, stillFailing);
    await screen.findByRole("button", { name: "Try again" });

    await userEvent.type(screen.getByRole("textbox"), "ed");

    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe(
      "started",
    );
  });

  it("respects read-only", async () => {
    await renderFallback({ value: "x", readOnly: true }, stillFailing);
    await screen.findByRole("button", { name: "Try again" });

    expect(screen.getByRole<HTMLTextAreaElement>("textbox").readOnly).toBe(
      true,
    );
  });

  it("doesn't submit a surrounding form when trying again", async () => {
    const onSubmit = jest.fn((event: React.FormEvent) =>
      event.preventDefault(),
    );
    const Fallback = await loadFallback();
    setMonacoSetup(stillFailing);
    render(
      <form onSubmit={onSubmit}>
        <Fallback value="x" />
      </form>,
    );

    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );
    await screen.findByRole("button", { name: "Try again" });

    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("recovers on its own when a later attempt succeeds, keeping the edits", async () => {
    await renderFallback({ defaultValue: "kept" }, () => Promise.resolve());

    const editor = await screen.findByTestId("monaco");

    expect(editor.textContent).toBe("kept");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("recovers when the user tries again and the download now works", async () => {
    let online = false;
    const setup = () =>
      online ? Promise.resolve() : Promise.reject(new Error("ChunkLoadError"));
    await renderFallback({ value: "x" }, setup);
    const retry = await screen.findByRole("button", { name: "Try again" });

    online = true;
    await userEvent.click(retry);

    await screen.findByTestId("monaco");
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("stays usable when trying again fails too", async () => {
    await renderFallback({ value: "x" }, stillFailing);

    await userEvent.click(
      await screen.findByRole("button", { name: "Try again" }),
    );

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Try again" })).toHaveProperty(
        "disabled",
        false,
      ),
    );
    expect(screen.getByRole<HTMLTextAreaElement>("textbox").value).toBe("x");
  });
});

describe("MonacoEditor", () => {
  async function renderEditor(props: MonacoEditorProps = {}) {
    render(<MonacoEditor {...props} />);
    await screen.findByTestId("monaco");
  }

  const MONACO_LANGUAGES = path.join(
    path.dirname(require.resolve("monaco-editor/editor/editor.api.js")),
    "../languages/definitions",
  );

  const languages: [EditorLanguage, string][] = [
    ["javascript", "javascript"],
    ["typescript", "typescript"],
    ["python", "python"],
    ["bash", "shell"],
    ["json", "json"],
    ["yaml", "yaml"],
    ["sql", "sql"],
    ["dockerfile", "dockerfile"],
    ["markdown", "markdown"],
    ["html", "html"],
    ["text", "plaintext"],
  ];

  it.each(languages)("gives Monaco the ID for %s", async (language, id) => {
    await renderEditor({ language });

    expect(mockEditor).toHaveBeenLastCalledWith(
      expect.objectContaining({ language: id }),
    );
  });

  // Monaco shows an ID it doesn't know as plain text, with no error. json comes from
  // its language services and plaintext is built in, not from these definitions.
  it.each(languages.filter(([, id]) => id !== "json" && id !== "plaintext"))(
    "maps %s to a language Monaco has",
    (_language, id) => {
      expect(
        fs.existsSync(path.join(MONACO_LANGUAGES, id, "register.js")),
      ).toBe(true);
    },
  );

  it("doesn't submit a surrounding form from the expand controls", async () => {
    const onSubmit = jest.fn((event: React.FormEvent) =>
      event.preventDefault(),
    );
    render(
      <form onSubmit={onSubmit}>
        <MonacoEditor value="x" />
      </form>,
    );

    await userEvent.click(await screen.findByTitle("Expand editor"));
    await userEvent.click(
      await screen.findByRole("button", { name: "Minimize" }),
    );

    expect(onSubmit).not.toHaveBeenCalled();
  });
});
