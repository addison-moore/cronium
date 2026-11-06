/**
 * What the production build put where. Monaco is about 4 MB of JavaScript that only
 * editor pages should download, and nothing else in CI would notice it moving: every
 * test still passes, and each page just gets slower. The harness has already run
 * `next build`, so this only reads the output.
 */
import fs from "node:fs";
import path from "node:path";

const NEXT_DIR = path.resolve(__dirname, "../../apps/cronium-app/.next");
const CHUNKS_DIR = path.join(NEXT_DIR, "static/chunks");

// Strings from Monaco's own modules, not from @monaco-editor/react, the small wrapper
// that is allowed everywhere. These two are in the modules Monaco's main chunk shares
// with its workers, which are what reach `commons` when its exclusion in
// next.config.mjs stops working. Strings from the editor's features wouldn't catch
// that, because only the main chunk uses those.
const MONACO_MARKERS = ["MonacoEnvironment", "editor.action.triggerSuggest"];

const holdsMonaco = (source: string) =>
  MONACO_MARKERS.some((marker) => source.includes(marker));

function filesUnder(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return filesUnder(entryPath);
    return entry.name.endsWith(".js") ? [entryPath] : [];
  });
}

const chunks = filesUnder(CHUNKS_DIR);
const relative = (file: string) => path.relative(NEXT_DIR, file);

describe("Monaco in the production build", () => {
  it("is in the client bundle, so the checks below can fail", () => {
    // Control: if Monaco renames these strings, the rest of this file passes for
    // the wrong reason.
    expect(
      chunks.filter((file) => holdsMonaco(fs.readFileSync(file, "utf8"))),
    ).not.toEqual([]);
  });

  it("stays out of the commons chunk that every page loads", () => {
    const commons = chunks.filter((file) =>
      path.basename(file).startsWith("commons"),
    );

    expect(commons).not.toEqual([]);
    expect(
      commons
        .filter((file) => holdsMonaco(fs.readFileSync(file, "utf8")))
        .map(relative),
    ).toEqual([]);
  });

  it("stays out of the server bundle", () => {
    expect(
      filesUnder(path.join(NEXT_DIR, "server"))
        .filter((file) => holdsMonaco(fs.readFileSync(file, "utf8")))
        .map(relative),
    ).toEqual([]);
  });
});
