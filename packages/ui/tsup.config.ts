import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  external: ["react", "react-dom", "next", "next/*", "react/jsx-runtime"],
  clean: true,
  minify: process.env.NODE_ENV === "production",
  splitting: false,
  treeshake: false,
  onSuccess: async () => {
    // Add "use client" directive to the built files
    const fs = (await import("fs")).default;
    const path = (await import("path")).default;

    const distPath = path.join(process.cwd(), "dist");
    const files = ["index.js", "index.mjs"];

    for (const file of files) {
      const filePath = path.join(distPath, file);
      if (fs.existsSync(filePath)) {
        const content = fs.readFileSync(filePath, "utf-8");
        if (!content.startsWith('"use client"')) {
          fs.writeFileSync(filePath, '"use client";\n' + content);
        }
      }
    }
  },
});
