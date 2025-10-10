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

    // Process styles.css through PostCSS to compile Tailwind
    console.log("Processing styles.css through PostCSS...");
    const { default: postcss } = await import("postcss");
    const tailwindcssPlugin = await import("@tailwindcss/postcss");

    const srcStylesPath = path.join(process.cwd(), "src", "styles.css");
    const distStylesPath = path.join(distPath, "styles.css");

    if (fs.existsSync(srcStylesPath)) {
      const css = fs.readFileSync(srcStylesPath, "utf-8");

      try {
        // Load Tailwind CSS v4 PostCSS plugin
        const processor = postcss([tailwindcssPlugin.default()]);
        const result = await processor.process(css, {
          from: srcStylesPath,
          to: distStylesPath,
        });

        fs.writeFileSync(distStylesPath, result.css);
        if (result.map) {
          fs.writeFileSync(distStylesPath + ".map", result.map.toString());
        }
        console.log("✓ styles.css processed successfully");
      } catch (error) {
        console.error("Error processing styles.css:", error);
        // Fallback to copying if PostCSS fails
        fs.copyFileSync(srcStylesPath, distStylesPath);
      }
    }
  },
});
