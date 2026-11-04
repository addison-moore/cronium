/**
 * CodeViewer renders its output as HTML and is used for script output, so whatever
 * reaches it unhighlighted still has to be escaped.
 */
import { render, screen, waitFor } from "@testing-library/react";
import { CodeViewer } from "../../../../../packages/ui/src/components/code-viewer";

jest.mock("prismjs", () => {
  const prism = {
    languages: { text: {} } as Record<string, unknown>,
    highlight: jest.fn((code: string) => `<b>highlighted</b>${code.length}`),
  };
  return { __esModule: true, default: prism };
});
jest.mock("prismjs/plugins/line-numbers/prism-line-numbers", () => ({}), {
  virtual: true,
});

const HOSTILE = `<img src=x onerror="alert(1)"> & more`;

beforeEach(() => {
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

const renderedCode = async (language: string) => {
  const { container } = render(
    <CodeViewer code={HOSTILE} language={language} showLineNumbers={false} />,
  );
  await waitFor(() => expect(container.querySelector("code")).not.toBeNull());
  return container.querySelector("code")!;
};

describe("CodeViewer", () => {
  it("escapes code when the language has no grammar", async () => {
    const code = await renderedCode("no-such-language");

    expect(code.querySelector("img")).toBeNull();
    expect(code.textContent).toBe(HOSTILE);
    expect(screen.queryByRole("img")).toBeNull();
  });

  it("uses the highlighter when there is a grammar", async () => {
    const code = await renderedCode("text");

    expect(code.innerHTML).toContain("<b>highlighted</b>");
  });
});
